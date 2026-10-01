import { NextRequest, NextResponse } from "next/server";
import { londonDayRangeUtc } from "@/lib/london-date";
import supabase from "@/lib/supabase";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { generateOrderNumber } from "@/lib/orders";
import { findOrCreateCustomerByPhone } from "@/lib/customers";
import { computeBill } from "@/lib/order-totals";
import { staffLocationIds } from "@/lib/locations";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = bizDb(session.businessId);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const date = searchParams.get("date");
    const tableId = searchParams.get("table_id");
    const orderType = searchParams.get("order_type");
    const source = searchParams.get("source"); // 'website' = customer self-service (takeaway/delivery), not a staff-created POS order
    // Item count + payment method need extra joins other callers (Online/Open
    // Orders panels, polling every 15s) don't need — opt-in only, for History.
    const detailed = searchParams.get("detailed") === "true";

    let query = db
      .from("orders")
      .select(`
        *,
        restaurant_tables(table_number),
        staff:staff!orders_staff_id_fkey(name)
      `)
      .order("created_at", { ascending: false });

    // Apply location filter: if staff has assigned locations, only show those.
    // If no restrictions, show all (including orders with NULL location_id for backward compatibility).
    const assignedLocationIds = await staffLocationIds(session.id);
    if (assignedLocationIds.length > 0) {
      query = query.in("location_id", assignedLocationIds);
    }

    if (status === "open") {
      // "open" means any unpaid, active order
      query = query.not("status", "in", '("paid","cancelled")');
    } else if (status) {
      query = query.eq("status", status);
    }

    if (orderType) {
      query = query.eq("order_type", orderType);
    }

    if (source === "website") {
      // Website orders never have a staff_id — only staff-created POS orders do.
      query = query.is("staff_id", null).in("order_type", ["takeaway", "delivery"]);
    }

    if (tableId) {
      query = query.eq("table_id", Number(tableId));
    }

    if (date) {
      // A UK calendar day — an order at 00:19 UK time belongs to that date,
      // even though it's still the previous day in UTC (summer time).
      const { start, end } = londonDayRangeUtc(date);
      query = query.gte("created_at", start).lte("created_at", end);
    }

    const { data: orders, error } = await query;
    if (error) throw error;

    // Flatten joined fields to match original shape
    let flatOrders = (orders ?? []).map((o) => {
      const { restaurant_tables: rt, staff: s, ...rest } = o as typeof o & {
        restaurant_tables: { table_number: string } | null;
        staff: { name: string } | null;
      };
      return {
        ...rest,
        table_number: rt?.table_number ?? null,
        staff_name: s?.name ?? null,
      };
    });

    if (source === "website") {
      // A stripe_session_id means the customer chose to pay online — don't
      // surface it to staff (who'd otherwise start cooking) until the
      // webhook actually confirms payment. An order with no session (paid
      // at collection/delivery) still shows immediately as normal.
      flatOrders = flatOrders.filter(
        (o) => !o.stripe_session_id || Number(o.amount_paid) >= Number(o.total)
      );
    }

    if (detailed && flatOrders.length > 0) {
      const orderIds = flatOrders.map((o) => o.id);
      const [{ data: itemRows }, { data: paymentRows }] = await Promise.all([
        supabase.from("order_items").select("order_id").in("order_id", orderIds).neq("status", "cancelled"),
        supabase.from("payments").select("order_id, method, amount").in("order_id", orderIds),
      ]);

      const itemCountMap: Record<number, number> = {};
      for (const i of itemRows || []) itemCountMap[i.order_id] = (itemCountMap[i.order_id] || 0) + 1;

      const methodLabel: Record<string, string> = { cash: "Cash", card: "Card", card_online: "Online" };
      const methodMap: Record<number, Set<string>> = {};
      const refundedMap: Record<number, number> = {};
      for (const p of paymentRows || []) {
        if (Number(p.amount) < 0) {
          refundedMap[p.order_id] = (refundedMap[p.order_id] || 0) - Number(p.amount);
          continue; // a refund isn't "how this order was paid"
        }
        if (Number(p.amount) === 0) continue;
        (methodMap[p.order_id] ??= new Set()).add(methodLabel[p.method] ?? p.method);
      }

      flatOrders = flatOrders.map((o) => ({
        ...o,
        item_count: itemCountMap[o.id] || 0,
        payment_method: methodMap[o.id] ? [...methodMap[o.id]].join(" + ") : null,
        refunded_amount: Math.round((refundedMap[o.id] || 0) * 100) / 100,
      }));
    }

    return NextResponse.json({ orders: flatOrders });
  } catch (error) {
    console.error("Orders fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      location_id: providedLocationId,
      order_type,
      table_id,
      customer_name,
      customer_phone,
      customer_address,
      customer_email,
      marketing_consent,
      items,
      notes,
      discount,
      discount_reason,
    } = body;

    if (!order_type || !items || items.length === 0) {
      return NextResponse.json(
        { error: "Order type and items required" },
        { status: 400 }
      );
    }

    const db = bizDb(session.businessId);

    // Determine the location_id: use provided, or auto-detect from staff assignments
    let location_id = providedLocationId;
    if (!location_id) {
      const assignedLocationIds = await staffLocationIds(session.id);
      if (assignedLocationIds.length === 1) {
        // Staff is assigned to exactly one location — use it
        location_id = assignedLocationIds[0];
      } else if (assignedLocationIds.length === 0) {
        // Staff has no restrictions — default to location 1 (business's primary location)
        location_id = 1;
      } else {
        // Staff is assigned to multiple locations — they must choose
        return NextResponse.json(
          { error: "Please choose a location" },
          { status: 400 }
        );
      }
    }

    // Verify location exists and belongs to this business
    const { data: location, error: locError } = await db
      .from("locations")
      .select("id")
      .eq("id", location_id)
      .maybeSingle();
    if (locError) throw locError;
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    // Verify staff can access this location (if they have restrictions)
    const assignedLocationIds = await staffLocationIds(session.id);
    if (assignedLocationIds.length > 0 && !assignedLocationIds.includes(location_id)) {
      return NextResponse.json({ error: "You cannot create orders at this location" }, { status: 403 });
    }

    // Dishes and tables must be this business's own.
    const menuItemIds = (items as { menu_item_id?: number }[]).map((i) => i.menu_item_id).filter((id): id is number => !!id);
    if (!(await allOwned(db, "menu_items", menuItemIds))) {
      return NextResponse.json({ error: "One of those dishes isn't on this business's menu" }, { status: 400 });
    }
    if (table_id && !(await allOwned(db, "restaurant_tables", [table_id]))) {
      return NextResponse.json({ error: "That table isn't this business's" }, { status: 400 });
    }

    if (order_type === "delivery" && !String(customer_address || "").trim()) {
      return NextResponse.json(
        { error: "A delivery address is required" },
        { status: 400 }
      );
    }

    // This business's open till shift
    const { data: workPeriod } = await db
      .from("work_periods")
      .select("id")
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .single();

    // Calculate totals — subtotal -> VAT -> discount -> total (see lib/order-totals.ts).
    // New orders never start with a service charge; that's applied later via
    // PUT /api/orders/:id/service-charge if needed.
    const subtotal = items.reduce(
      (sum: number, item: { item_price: number; quantity: number }) =>
        sum + item.item_price * item.quantity,
      0
    );
    const discountAmt = discount || 0;
    const bill = computeBill({
      subtotal,
      discountType: discountAmt > 0 ? "amount" : null,
      discountPct: null,
      discountAmount: discountAmt,
      serviceChargePct: 0,
    });
    const { tax, total } = bill;

    const customerId = customer_phone
      ? await findOrCreateCustomerByPhone(session.businessId, customer_phone, customer_name || "Guest", customer_email, marketing_consent === true)
      : null;

    // generateOrderNumber() isn't locked against a concurrent request landing
    // on the same next number — retry a couple of times with a freshly
    // regenerated number if the unique constraint catches a collision.
    let newOrder: { id: number; order_number: string } | null = null;
    let orderError: { code?: string; message?: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const orderNumber = await generateOrderNumber(session.businessId);
      const result = await db
        .from("orders")
        .insert({
          order_number: orderNumber,
          order_type,
          location_id,
          table_id: table_id || null,
          customer_id: customerId,
          customer_name: customer_name || null,
          customer_phone: customer_phone || null,
          customer_address: customer_address || null,
          staff_id: session.id,
          work_period_id: workPeriod?.id || null,
          subtotal,
          discount: discountAmt,
          discount_type: discountAmt > 0 ? "amount" : null,
          discount_reason: discount_reason || null,
          tax,
          total,
          notes: notes || null,
          status: "open",
        })
        .select()
        .single();
      newOrder = result.data;
      orderError = result.error;
      if (!orderError || orderError.code !== "23505") break;
    }

    if (orderError) throw orderError;

    const orderId = newOrder!.id;

    // Insert order items
    type IncomingItem = {
      menu_item_id?: number;
      item_name: string;
      item_price: number;
      quantity: number;
      notes?: string;
      selected_modifiers?: { id: number; name: string; price_delta: number }[];
    };
    const typedItems = items as IncomingItem[];
    const itemRows = typedItems.map((item) => ({
      order_id: orderId,
      menu_item_id: item.menu_item_id || null,
      item_name: item.item_name,
      item_price: item.item_price,
      quantity: item.quantity,
      original_quantity: item.quantity,
      notes: item.notes || null,
    }));

    const { data: insertedItems, error: itemsError } = await supabase
      .from("order_items")
      .insert(itemRows)
      .select("id, menu_item_id");

    if (itemsError) throw itemsError;

    const modifierRows = (insertedItems || []).flatMap((row, idx) =>
      (typedItems[idx].selected_modifiers || []).map((m) => ({
        order_item_id: row.id,
        modifier_option_id: m.id,
        option_name: m.name,
        price_delta: m.price_delta,
      }))
    );
    if (modifierRows.length > 0) {
      const { error: modErr } = await supabase.from("order_item_modifiers").insert(modifierRows);
      if (modErr) throw modErr;
    }

    // Update table status if dine-in
    if (order_type === "dine_in" && table_id) {
      await db
        .from("restaurant_tables")
        .update({ status: "occupied" })
        .eq("id", table_id);
    }

    // Fetch full order with joins
    const { data: order, error: fetchError } = await db
      .from("orders")
      .select(`
        *,
        restaurant_tables(table_number),
        staff:staff!orders_staff_id_fkey(name)
      `)
      .eq("id", orderId)
      .single();

    if (fetchError) throw fetchError;

    const { restaurant_tables: rt, staff: s, ...orderRest } = order as typeof order & {
      restaurant_tables: { table_number: string } | null;
      staff: { name: string } | null;
    };

    return NextResponse.json(
      {
        success: true,
        order: { ...orderRest, table_number: rt?.table_number ?? null, staff_name: s?.name ?? null },
        items: insertedItems,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Order create error:", error);
    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }
}
