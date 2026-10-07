import supabase from "@/lib/supabase";

export async function getOrderForReceipt(orderId: number) {
  const { data: order } = await supabase
    .from("orders")
    .select("*, restaurant_tables(table_number, join_label), staff:staff!orders_staff_id_fkey(name)")
    .eq("id", orderId)
    .single();
  if (!order) return null;

  const { data: items } = await supabase
    .from("order_items")
    .select("id, item_name, item_price, quantity, notes, status")
    .eq("order_id", orderId)
    .neq("status", "cancelled")
    .order("created_at");

  const itemIds = (items || []).map((i) => i.id);
  const { data: modifiers } = itemIds.length > 0
    ? await supabase.from("order_item_modifiers").select("order_item_id, option_name, price_delta").in("order_item_id", itemIds)
    : { data: [] };

  const modsByItem = new Map<number, { option_name: string; price_delta: number }[]>();
  for (const m of modifiers || []) {
    const list = modsByItem.get(m.order_item_id) || [];
    list.push({ option_name: m.option_name, price_delta: Number(m.price_delta) });
    modsByItem.set(m.order_item_id, list);
  }

  // Full payment history, refunds included (negative amounts) — a "reprint
  // receipt" on a since-refunded order should show that, not pretend it
  // never happened.
  const { data: payments } = await supabase
    .from("payments")
    .select("method, amount, tip_amount, change_given, reference, created_at")
    .eq("order_id", orderId)
    .order("created_at");

  const { restaurant_tables: table, staff, ...orderRest } = order as typeof order & {
    restaurant_tables: { table_number: string; join_label?: string | null } | null;
    staff: { name: string } | null;
  };

  return {
    order: { ...orderRest, table_number: (table?.join_label || table?.table_number) ?? null, staff_name: staff?.name ?? null },
    items: (items || []).map((i) => ({ ...i, modifiers: modsByItem.get(i.id) || [] })),
    payments: payments || [],
  };
}
