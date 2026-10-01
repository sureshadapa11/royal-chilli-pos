import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";

// Things that must only be entered once (a supplier, an ingredient, a dish's
// recipe) are checked here before insert, so the same thing can't end up in
// two rows and be counted twice.

/**
 * Case- and space-insensitive name match against active rows of `table`,
 * within one business (each business has its own suppliers and ingredients).
 */
export async function findActiveByName(table: "suppliers" | "ingredients", name: string, excludeId?: number, businessId?: number, locationId?: number): Promise<{ id: number; name: string } | null> {
  const clean = name.trim().replace(/\s+/g, " ");
  const pattern = clean.replace(/[\%_]/g, (c) => `\${c}`);
  let q = (businessId != null ? bizDb(businessId) : { from: supabase.from.bind(supabase) }).from(table).select("id, name").eq("active", 1).ilike("name", pattern);
  if (table === "ingredients" && locationId != null) q = q.or(`location_id.eq.${locationId},location_id.is.null`);
  if (excludeId != null) q = q.neq("id", excludeId);
  const { data, error } = await q.limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Another active recipe already linked to this dish (in this business)? */
export async function recipeForDish(businessId: number, menuItemId: number, excludeRecipeId?: number): Promise<{ id: number; name: string } | null> {
  let q = bizDb(businessId).from("recipes").select("id, name").eq("menu_item_id", menuItemId).eq("active", 1);
  if (excludeRecipeId != null) q = q.neq("id", excludeRecipeId);
  const { data, error } = await q.limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

/** The same ingredient picked on two recipe lines is one ingredient: add the quantities. */
export function mergeRecipeLines(recipeId: number, lines: { ingredient_id: number; quantity: number; notes?: string }[]) {
  const merged = new Map<number, { quantity: number; notes: string | null }>();
  for (const l of lines) {
    if (!l.ingredient_id || !(Number(l.quantity) > 0)) continue;
    const cur = merged.get(l.ingredient_id);
    merged.set(l.ingredient_id, { quantity: (cur?.quantity ?? 0) + Number(l.quantity), notes: cur?.notes ?? l.notes ?? null });
  }
  return [...merged].map(([ingredient_id, v]) => ({ recipe_id: recipeId, ingredient_id, quantity: v.quantity, notes: v.notes }));
}
