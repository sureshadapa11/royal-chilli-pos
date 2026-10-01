import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { cancelOrderAndFreeTable } from "@/lib/orders";
import { recalcTotals } from "@/lib/order-totals";
import { findOrCreateCustomerByPhone } from "@/lib/customers";
import { queueKitchenTicketSafely } from "@/lib/print-queue";
import { staffLocationFilter } from "@/lib/location-filter";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const db = bizDb(session.businessId);

    const { data: order, error: orderError } = await db
      .from("orders")
      .select(`
        *,
        restaurant_tables(table_number),
        staff:staff!orders_staff_id_fkey(name)
      `)
      .eq("id", id)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Check location filter: if staff has assigned locations, verify this order belongs to one
    const locationFilter = await staffLocationFilter(session.id);
    if (locationFilter && !locationFilter.in.includes(order.location_id)) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const { restaurant_tables: rt, staff: s, ...orderRest } = order as typeof order & {
      restaurant_tables: { table_number: string } | null;
      staff: { name: string } | null;
    };

    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", id)
      .order("created_at");

    if (itemsError) throw itemsError;

    return NextResponse.json({
      order: { ...orderRest, table_number: rt?.table_number ?? null, staff_name: s?.name ?? null },
      items,
    });
  } catch (error) {
    console.error("Order fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch order" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const db = bizDb(session.businessId);
    const body = await req.json();
    const { status, discount_type, discount_value, discount_reason, discount_given_by_staff_id, notes, customer_name, customer_phone, customer_email, marketing_consent } = body;

    const { data: order, error: fetchError } = await db
      .from("orders")
      .select("id, table_id, status, is_paid, location_id")
      .eq("id", id)
      .single();

    if (fetchError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Check location filter
    const locationFilter = await staffLocationFilter(session.id);
    if (locationFilter && !locationFilter.in.includes(order.location_id)) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (status === "cancelled") {
      const result = await cancelOrderAndFreeTable(Number(id), order.table_id);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 409 });
      }
    } else if (status) {
      const { error } = await db
        .from("orders")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw error;

      // Till "Send to Kitchen": each send is its own order row (created
      // "open", then flipped here), so the whole order is exactly this round.
      if (status === "sent_to_kitchen" && order.status === "open") {
        await queueKitchenTicketSafely(order.id, "till");
      }

      // Free table when the order is fully paid this way (rare — normal
      // payments go through /payment, which handles this itself).
      if (status === "paid" && order.table_id) {
        await db
          .from("restaurant_tables")
          .update({ status: "available", self_order_enabled: false })
          .eq("id", order.table_id);
      }
    }

    if (discount_type !== undefined) {
      // Discount/service-charge changes are refused once the bill is fully
      // settled — otherwise it silently rewrites a total that's already
      // been paid and reported on.
      if (order.is_paid) {
        return NextResponse.json({ error: "Cannot change the discount on an order that's already fully paid" }, { status: 409 });
      }

      // A manual discount must say who gave it (the till is one shared
      // login, so staff pick their name) — recorded on the order only.
      // Removing the discount clears it.
      const resolveGiver = async () => {
        const { data: giver } = await supabase
          .from("staff")
          .select("id, name")
          .eq("id", Number(discount_given_by_staff_id) || 0)
          .eq("active", 1)
          .maybeSingle();
        return giver ? { discount_given_by_staff_id: giver.id as number, discount_given_by: giver.name as string } : null;
      };
      const noGiver = NextResponse.json({ error: "Choose who is giving this discount" }, { status: 400 });

      if (discount_type === null) {
        const { error } = await db
          .from("orders")
          .update({ discount_type: null, discount_pct: null, discount: 0, discount_reason: null, discount_given_by_staff_id: null, discount_given_by: null, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      } else if (discount_type === "percent") {
        if (typeof discount_value !== "number" || discount_value <= 0 || discount_value > 100) {
          return NextResponse.json({ error: "discount_value must be between 0 and 100 for a percent discount" }, { status: 400 });
        }
        const givenBy = await resolveGiver();
        if (!givenBy) return noGiver;
        const { error } = await db
          .from("orders")
          .update({ discount_type: "percent", discount_pct: discount_value, discount_reason: discount_reason || null, ...givenBy, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      } else if (discount_type === "amount") {
        if (typeof discount_value !== "number" || discount_value < 0) {
          return NextResponse.json({ error: "discount_value must be a positive amount" }, { status: 400 });
        }
        const givenBy = await resolveGiver();
        if (!givenBy) return noGiver;
        const { error } = await db
          .from("orders")
          .update({ discount_type: "amount", discount_pct: null, discount: discount_value, discount_reason: discount_reason || null, ...givenBy, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      } else {
        return NextResponse.json({ error: "discount_type must be \"percent\", \"amount\", or null" }, { status: 400 });
      }

      await recalcTotals(id);
    }

    if (notes !== undefined) {
      const { error } = await db.from("orders").update({ notes, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    }

    // Attaches a customer to an order after the fact — needed for dine-in,
    // where the order is usually already created (Send to Kitchen) by the
    // time a phone number is captured at payment. Same link-or-create as a
    // brand-new order (POST /api/orders); loyalty then picks it up
    // automatically off orders.customer_id once payment completes.
    if (customer_phone !== undefined && String(customer_phone).trim()) {
      const customerId = await findOrCreateCustomerByPhone(session.businessId, String(customer_phone).trim(), customer_name || "Guest", customer_email, marketing_consent === true);
      const { error } = await db
        .from("orders")
        .update({ customer_id: customerId, customer_name: customer_name || null, customer_phone: String(customer_phone).trim(), updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    }

    const { data: updated, error: updError } = await db
      .from("orders")
      .select(`
        *,
        restaurant_tables(table_number),
        staff:staff!orders_staff_id_fkey(name)
      `)
      .eq("id", id)
      .single();

    if (updError) throw updError;

    const { restaurant_tables: rt, staff: s, ...orderRest } = updated as typeof updated & {
      restaurant_tables: { table_number: string } | null;
      staff: { name: string } | null;
    };

    return NextResponse.json({
      success: true,
      order: { ...orderRest, table_number: rt?.table_number ?? null, staff_name: s?.name ?? null },
    });
  } catch (error) {
    console.error("Order update error:", error);
    return NextResponse.json(
      { error: "Failed to update order" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const db = bizDb(session.businessId);

    const { data: order, error: fetchError } = await db
      .from("orders")
      .select("id, table_id, location_id")
      .eq("id", id)
      .single();

    if (fetchError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Check location filter
    const locationFilter = await staffLocationFilter(session.id);
    if (locationFilter && !locationFilter.in.includes(order.location_id)) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const result = await cancelOrderAndFreeTable(Number(id), order.table_id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Order delete error:", error);
    return NextResponse.json(
      { error: "Failed to cancel order" },
      { status: 500 }
    );
  }
}
