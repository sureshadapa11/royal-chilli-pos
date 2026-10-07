import supabase from "@/lib/supabase";

export async function getOrderForPrint(orderId: number) {
  const { data: order } = await supabase
    .from("orders")
    .select("*, restaurant_tables(table_number, join_label)")
    .eq("id", orderId)
    .single();
  if (!order) return null;

  const { data: items } = await supabase
    .from("order_items")
    .select("id, item_name, quantity, notes, status, menu_items(allergens)")
    .eq("order_id", orderId)
    .neq("status", "cancelled")
    .order("created_at");

  const itemIds = (items || []).map((i) => i.id);
  const { data: modifiers } = itemIds.length > 0
    ? await supabase.from("order_item_modifiers").select("order_item_id, option_name").in("order_item_id", itemIds)
    : { data: [] };

  const modsByItem = new Map<number, string[]>();
  for (const m of modifiers || []) {
    modsByItem.set(m.order_item_id, [...(modsByItem.get(m.order_item_id) || []), m.option_name]);
  }

  const { restaurant_tables: table, ...orderRest } = order as typeof order & { restaurant_tables: { table_number: string; join_label?: string | null } | null };

  return {
    order: { ...orderRest, table_number: (table?.join_label || table?.table_number) ?? null },
    items: (items || []).map(({ menu_items: menuItem, ...i }) => ({
      ...i,
      modifiers: modsByItem.get(i.id) || [],
      // From the dish itself, so the kitchen sees them on every ticket.
      allergens: ((menuItem as unknown as { allergens: string[] | null } | null)?.allergens ?? []).filter(Boolean),
    })),
  };
}
