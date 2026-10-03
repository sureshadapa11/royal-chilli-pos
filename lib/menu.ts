import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { isSoldOut } from "@/lib/sold-out";

export type MenuItemModifierOption = {
  id: number;
  name: string;
  price_delta: number;
};

export type MenuItemModifierGroup = {
  id: number;
  name: string;
  selection_type: "single" | "multiple";
  min_select: number;
  max_select: number | null;
  required: boolean;
  options: MenuItemModifierOption[];
};

export type MenuChannel = "pos" | "online";

// Which of an item's two prices an order pays. Collection = the till price
// (menu_items.price) — also dine-in, table QR and till takeaway. Delivery =
// menu_items.online_price, falling back to the till price when unset —
// website delivery and till (phone) delivery orders alike.
export type PriceType = "collection" | "delivery";

export function priceTypeFor(orderType: string): PriceType {
  return orderType === "delivery" ? "delivery" : "collection";
}

export function basePriceFor(item: { price: number | string; online_price?: number | string | null }, type: PriceType): number {
  return type === "delivery" && item.online_price != null ? Number(item.online_price) : Number(item.price);
}

export type MenuItem = {
  id: number;
  name: string;
  description: string | null;
  price: number; // collection / till price
  delivery_price: number; // delivery price (= price when no separate delivery price is set)
  is_veg: number;
  display_order: number;
  allergens: string[];
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  /** The dish's photo (Staff Hub → Website → Menu & photos), if any. */
  image_url: string | null;
  modifierGroups: MenuItemModifierGroup[];
};

export type MenuCategory = {
  id: number;
  name: string;
  display_order: number;
  items: MenuItem[];
};

// One business's menu (lib/business.ts). channel decides which availability
// flag each item is read through: "pos"
// (default) is the in-house till / dine-in menu, "online" is the website
// collection/delivery menu. Every item carries both prices (see PriceType);
// the order type picks which one applies. Categories with no items for the
// channel are dropped.
export async function getActiveMenu(businessId: number, channel: MenuChannel = "pos"): Promise<MenuCategory[]> {
  const db = bizDb(businessId);
  const { data: categories, error: catErr } = await db
    .from("menu_categories")
    .select("id, name, display_order")
    .eq("active", 1)
    .order("display_order");
  if (catErr) throw catErr;

  const availabilityCol = channel === "online" ? "online_available" : "pos_available";
  const { data: items, error: itemErr } = await db
    .from("menu_items")
    .select("id, category_id, name, description, price, online_price, is_veg, display_order, allergens, calories, protein_g, carbs_g, fat_g, sold_out_until, image_url")
    .eq("active", 1)
    .eq(availabilityCol, 1)
    .order("display_order");
  if (itemErr) throw itemErr;

  // Modifier links/options have no business of their own — take only those
  // for this business's items and groups.
  const itemIds = (items || []).map((i) => i.id);
  const { data: attachments } = itemIds.length > 0
    ? await supabase.from("menu_item_modifier_groups").select("menu_item_id, group_id, required, display_order").in("menu_item_id", itemIds).order("display_order")
    : { data: [] };
  const { data: groups } = await db.from("modifier_groups").select("*");
  const groupIds = (groups || []).map((g) => g.id);
  const { data: options } = groupIds.length > 0
    ? await supabase.from("modifier_options").select("*").in("group_id", groupIds).order("display_order")
    : { data: [] };

  const optionsByGroup = new Map<number, MenuItemModifierOption[]>();
  for (const o of options || []) {
    const list = optionsByGroup.get(o.group_id) || [];
    list.push({ id: o.id, name: o.name, price_delta: Number(o.price_delta) });
    optionsByGroup.set(o.group_id, list);
  }
  const groupsById = new Map((groups || []).map((g) => [g.id, g]));

  const modifierGroupsByItem = new Map<number, MenuItemModifierGroup[]>();
  for (const a of attachments || []) {
    const g = groupsById.get(a.group_id);
    if (!g) continue;
    const list = modifierGroupsByItem.get(a.menu_item_id) || [];
    list.push({
      id: g.id, name: g.name, selection_type: g.selection_type,
      min_select: g.min_select, max_select: g.max_select,
      required: !!a.required,
      options: optionsByGroup.get(g.id) || [],
    });
    modifierGroupsByItem.set(a.menu_item_id, list);
  }

  return (categories || [])
    .map((c) => ({
      ...c,
      items: (items || [])
        // Dishes marked sold out at the till are left off (website, table QR).
        .filter((i) => i.category_id === c.id && !isSoldOut(i))
        .map(({ id, name, description, price, online_price, is_veg, display_order, allergens, calories, protein_g, carbs_g, fat_g, image_url }) => ({
          id, name, description,
          price: basePriceFor({ price, online_price }, "collection"),
          delivery_price: basePriceFor({ price, online_price }, "delivery"),
          is_veg, display_order,
          allergens: allergens || [],
          calories: calories ?? null,
          protein_g: protein_g !== null ? Number(protein_g) : null,
          carbs_g: carbs_g !== null ? Number(carbs_g) : null,
          fat_g: fat_g !== null ? Number(fat_g) : null,
          image_url: image_url ?? null,
          modifierGroups: modifierGroupsByItem.get(id) || [],
        })),
    }))
    .filter((c) => c.items.length > 0);
}
