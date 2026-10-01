import { bizDb } from "@/lib/business-db";
import { generateOrderNumber } from "@/lib/orders";
import { resolveItemWithModifiers } from "@/lib/modifiers";
import { recalcTotals } from "@/lib/order-totals";
import { customerForOrder } from "@/lib/customers";

const OPEN_STATUSES = ["open", "sent_to_kitchen", "ready"];

// Table numbers repeat across businesses (each has its own table 5) — the
// QR code's domain (or ?b=) says whose.
export async function getTableByNumber(businessId: number, tableNumber: string) {
  const { data } = await bizDb(businessId)
    .from("restaurant_tables")
    .select("id, table_number, capacity, status, self_order_enabled, business_id")
    .eq("table_number", tableNumber)
    .maybeSingle();
  return data;
}

export async function getOpenOrderForTable(businessId: number, tableId: number) {
  const { data, error } = await bizDb(businessId)
    .from("orders")
    .select("*")
    .eq("table_id", tableId)
    .eq("order_type", "dine_in")
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getOrderItems(businessId: number, orderId: number) {
  const db = bizDb(businessId);
  const { data, error } = await db
    .from("order_items")
    .select("id, item_name, item_price, quantity, status, notes")
    .eq("order_id", orderId)
    .order("created_at");
  if (error) throw error;

  const itemIds = (data || []).map((i) => i.id);
  if (itemIds.length === 0) return data || [];
  const { data: modifiers } = await db
    .from("order_item_modifiers")
    .select("order_item_id, option_name, price_delta")
    .in("order_item_id", itemIds);
  const modsByItem = new Map<number, { option_name: string; price_delta: number }[]>();
  for (const m of modifiers || []) {
    const list = modsByItem.get(m.order_item_id) || [];
    list.push({ option_name: m.option_name, price_delta: Number(m.price_delta) });
    modsByItem.set(m.order_item_id, list);
  }
  return (data || []).map((i) => ({ ...i, modifiers: modsByItem.get(i.id) || [] }));
}

export async function addItemsToTable(
  businessId: number,
  tableId: number,
  rawItems: { menu_item_id: number; quantity: number; notes?: string; selected_options?: number[] }[],
  customer?: { accountId?: number | null; phone?: string; name?: string; email?: string; marketingConsent?: boolean }
) {
  const itemRows = await Promise.all(
    rawItems.map(async (item) => {
      const resolved = await resolveItemWithModifiers(businessId, item.menu_item_id, item.selected_options || [], "collection");
      const quantity = Math.max(1, Number(item.quantity) || 1);
      return {
        menu_item_id: resolved.menuItemId,
        item_name: resolved.itemName,
        item_price: resolved.unitPrice,
        quantity,
        original_quantity: quantity,
        notes: item.notes || null,
        status: "pending" as const,
        _modifiers: resolved.selectedModifiers,
      };
    })
  );

  const db = bizDb(businessId);
  let order = await getOpenOrderForTable(businessId, tableId);
  if (!order) {
    const orderNumber = await generateOrderNumber(businessId);
    const { data: newOrder, error: orderErr } = await bizDb(businessId)
      .from("orders")
      .insert({
        order_number: orderNumber,
        order_type: "dine_in",
        table_id: tableId,
        status: "sent_to_kitchen",
        subtotal: 0,
        discount: 0,
        tax: 0,
        total: 0,
      })
      .select()
      .single();
    if (orderErr) throw orderErr;
    order = newOrder;
    await db.from("restaurant_tables").update({ status: "occupied" }).eq("id", tableId);
  } else if (order.status === "ready") {
    // A new round arrived after the previous round was marked ready — back to the kitchen queue.
    await db.from("orders").update({ status: "sent_to_kitchen" }).eq("id", order.id);
  }

  // Optional self-service loyalty capture — a customer may submit their
  // phone on any round, not just the first, so this attaches (or
  // re-attaches, e.g. to backfill an email/consent given on a later round)
  // regardless of whether the order already had a customer.
  // Logged in on their phone → their own account, whatever number they typed.
  if (customer?.phone?.trim() || customer?.accountId) {
    const customerId = await customerForOrder(businessId, customer.accountId, customer.phone, customer.name || "Guest", customer.email, customer.marketingConsent === true);
    if (customerId) {
      await db
        .from("orders")
        .update({ customer_id: customerId, customer_name: customer.name || null, customer_phone: customer.phone?.trim() || null })
        .eq("id", order!.id);
    }
  }

  const insertedItemIds: number[] = [];
  for (const item of itemRows) {
    const { _modifiers, ...itemRow } = item;
    const { data: insertedItem, error: itemErr } = await db
      .from("order_items")
      .insert({ ...itemRow, order_id: order!.id })
      .select("id")
      .single();
    if (itemErr) throw itemErr;
    insertedItemIds.push(insertedItem.id);

    if (_modifiers.length > 0) {
      const { error: modErr } = await db.from("order_item_modifiers").insert(
        _modifiers.map((m) => ({ order_item_id: insertedItem.id, modifier_option_id: m.id, option_name: m.name, price_delta: m.price_delta }))
      );
      if (modErr) throw modErr;
    }
  }

  await recalcTotals(String(order!.id), businessId);
  return { orderId: order!.id as number, itemIds: insertedItemIds };
}
