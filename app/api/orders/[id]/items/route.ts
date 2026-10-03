import { NextRequest, NextResponse } from "next/server";
import { notifyOrderReady } from "@/lib/order-notifications";
import { waitUntil } from "@vercel/functions";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { recalcTotals } from "@/lib/order-totals";
import { cancelOrderAndFreeTable } from "@/lib/orders";
import { tillRequired } from "@/lib/till-device";

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
    if (!(await allOwned(db, "orders", [id]))) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const { data: items, error } = await db
      .from("order_items")
      .select(`
        *,
        menu_items(is_veg)
      `)
      .eq("order_id", id)
      .order("created_at");

    if (error) throw error;

    // Flatten is_veg from joined menu_items
    const flatItems = (items ?? []).map((item) => {
      const { menu_items: mi, ...rest } = item as typeof item & {
        menu_items: { is_veg: number } | null;
      };
      return {
        ...rest,
        is_veg: mi?.is_veg ?? 0,
      };
    });

    return NextResponse.json({ items: flatItems });
  } catch (error) {
    console.error("Order items fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch items" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const notTill = await tillRequired(req, session.businessId);
    if (notTill) return notTill;

    const { id } = await params;
    const { items } = await req.json();

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No items provided" }, { status: 400 });
    }

    const db = bizDb(session.businessId);
    const { data: order, error: orderFetchError } = await db
      .from("orders")
      .select("id")
      .eq("id", id)
      .single();

    if (orderFetchError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const menuItemIds = (items as { menu_item_id?: number }[]).map((i) => i.menu_item_id).filter((mid): mid is number => !!mid);
    if (!(await allOwned(db, "menu_items", menuItemIds))) {
      return NextResponse.json({ error: "One of those dishes isn't on this business's menu" }, { status: 400 });
    }

    const itemRows = items.map((item: {
      menu_item_id?: number;
      item_name: string;
      item_price: number;
      quantity: number;
      notes?: string;
    }) => ({
      order_id: Number(id),
      menu_item_id: item.menu_item_id || null,
      item_name: item.item_name,
      item_price: item.item_price,
      quantity: item.quantity,
      original_quantity: item.quantity,
      notes: item.notes || null,
    }));

    const { data: inserted, error: insertError } = await db
      .from("order_items")
      .insert(itemRows)
      .select("id");

    if (insertError) throw insertError;

    const insertedIds = (inserted ?? []).map((r: { id: number }) => r.id);

    // Recalculate order totals from all active items
    await recalcTotals(id, session.businessId);

    return NextResponse.json({ success: true, insertedIds });
  } catch (error) {
    console.error("Add items error:", error);
    return NextResponse.json({ error: "Failed to add items" }, { status: 500 });
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

    const { id: orderId } = await params;
    const { itemId, status, action, quantity } = await req.json();
    const db = bizDb(session.businessId);
    if (!(await allOwned(db, "orders", [orderId]))) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (action === "void") {
      // Once an order is paid, voiding an item wouldn't touch the money
      // already taken for it — that's what Refund is for — so it's blocked
      // here rather than left to silently drift out of sync.
      const { data: orderForVoid } = await db.from("orders").select("status, is_paid, table_id").eq("id", orderId).single();
      if (orderForVoid?.is_paid) {
        return NextResponse.json({ error: "Cannot void items on a paid order — use Refund from Order History instead." }, { status: 409 });
      }

      const { error } = await db
        .from("order_items")
        .update({ status: "cancelled" })
        .eq("id", itemId)
        .eq("order_id", orderId);

      if (error) throw error;
      await recalcTotals(orderId, session.businessId);

      // Voiding the last active item leaves an order with nothing left to
      // send or pay for — close it out the same way an explicit whole-order
      // cancel does, so a dine-in table doesn't stay stuck "occupied" with
      // an empty order (see cancelOrderAndFreeTable's docstring).
      const { count: remaining } = await db
        .from("order_items")
        .select("id", { count: "exact", head: true })
        .eq("order_id", orderId)
        .neq("status", "cancelled");
      if (remaining === 0) {
        await cancelOrderAndFreeTable(session.businessId, Number(orderId), orderForVoid?.table_id ?? null);
      }
    } else if (action === "reduce" && quantity > 0) {
      const { error } = await db
        .from("order_items")
        .update({ quantity })
        .eq("id", itemId)
        .eq("order_id", orderId);

      if (error) throw error;
      await recalcTotals(orderId, session.businessId);
    } else if (status) {
      const { error } = await db
        .from("order_items")
        .update({ status })
        .eq("id", itemId)
        .eq("order_id", orderId);

      if (error) throw error;

      // Item-level "bump": once the last pending item on a ticket is
      // bumped, the whole order auto-completes — kitchen doesn't need a
      // separate "mark order ready" tap on top of bumping every item.
      if (status === "ready") {
        const { count: stillPending } = await db
          .from("order_items")
          .select("id", { count: "exact", head: true })
          .eq("order_id", orderId)
          .eq("status", "pending");
        if (stillPending === 0) {
          await db
            .from("orders")
            .update({ status: "ready", updated_at: new Date().toISOString() })
            .eq("id", orderId)
            .eq("status", "sent_to_kitchen");
          waitUntil(notifyOrderReady(Number(orderId)));
        }
      } else if (status === "pending") {
        // Un-bumping an item on an order that had already auto-completed
        // reopens the order — it's no longer actually fully ready.
        await db
          .from("orders")
          .update({ status: "sent_to_kitchen", updated_at: new Date().toISOString() })
          .eq("id", orderId)
          .eq("status", "ready");
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Order item update error:", error);
    return NextResponse.json({ error: "Failed to update item" }, { status: 500 });
  }
}
