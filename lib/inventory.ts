import supabase from "@/lib/supabase";
import { tradingRangeUtc } from "@/lib/london-date";
import { allRows, chunked, getSalesData, r2 } from "@/lib/finance";
import { bizDb } from "@/lib/business-db";
import { loadRecipeBook, recipeUsage } from "@/lib/recipes";

export type ReconciliationLine = {
  ingredient_id: number;
  ingredient_name: string;
  unit: string;
  theoretical_usage: number;
  actual_usage: number;
  variance_qty: number;
  variance_value: number;
};

export type ReconciliationReport = {
  period: { from: string; to: string };
  net_sales: number;
  cogs_theoretical: number;
  cogs_actual: number;
  gp_theoretical: number | null;
  gp_actual: number | null;
  gp_gap: number | null;
  lines: ReconciliationLine[];
};

// Deplete ingredient stock for a paid order, based on each line item's
// recipe (recipe_ingredients scaled by the recipe's yield). Items with no
// recipe entered yet are silently skipped — this is additive/best-effort
// bookkeeping, never a condition for the sale itself, so callers should
// never let a failure here affect the payment response.
export async function depleteStockForOrder(orderId: number, staffId: number | null): Promise<void> {
  const { data: order } = await supabase.from("orders").select("business_id, location_id").eq("id", orderId).maybeSingle();
  if (!order) return;
  const db = bizDb(order.business_id);
  const locationId = order.location_id ?? 1;

  // Both Pay Later and an eventual full payment call this for the same
  // order — without this guard, a Pay Later order that later gets paid off
  // has its stock deducted twice for the same food.
  const { data: existing } = await db
    .from("stock_movements")
    .select("id")
    .eq("reference_type", "order")
    .eq("reference_id", orderId)
    .eq("movement_type", "usage")
    .limit(1);
  if (existing && existing.length > 0) return;

  const { data: items } = await db
    .from("order_items")
    .select("menu_item_id, quantity")
    .eq("order_id", orderId)
    .neq("status", "cancelled");

  if (!items || items.length === 0) return;

  const menuItemIds = [...new Set(items.map((i) => i.menu_item_id).filter((id): id is number => id != null))];
  const book = await loadRecipeBook(order.business_id, menuItemIds);
  // One movement row per ingredient, even if a dish appears twice in the order.
  const { usage: deltaByIngredient } = recipeUsage(book, items);

  if (deltaByIngredient.size === 0) return;

  const { data: recipeIngredients } = await db
    .from("ingredients")
    .select("id, name, unit, location_id")
    .in("id", [...deltaByIngredient.keys()]);
  const { data: locationIngredients } = await db
    .from("ingredients")
    .select("id, name, unit, location_id")
    .eq("location_id", locationId);
  const byId = new Map((recipeIngredients ?? []).map((ingredient) => [ingredient.id, ingredient]));
  const byNameAndUnit = new Map(
    (locationIngredients ?? []).map((ingredient) => [
      `${ingredient.name.trim().toLowerCase()}\0${ingredient.unit.trim().toLowerCase()}`,
      ingredient.id,
    ]),
  );
  const locationUsage = new Map<number, number>();
  for (const [ingredientId, used] of deltaByIngredient) {
    const ingredient = byId.get(ingredientId);
    if (!ingredient) continue;
    const targetIngredientId = ingredient.location_id == null || ingredient.location_id === locationId
      ? ingredient.id
      : byNameAndUnit.get(`${ingredient.name.trim().toLowerCase()}\0${ingredient.unit.trim().toLowerCase()}`);
    if (targetIngredientId == null) continue;
    locationUsage.set(targetIngredientId, (locationUsage.get(targetIngredientId) ?? 0) + used);
  }
  if (locationUsage.size === 0) return;

  const movements = [...locationUsage.entries()].map(([ingredient_id, used]) => ({
    ingredient_id,
    movement_type: "usage" as const,
    quantity_delta: -Math.round(used * 1000) / 1000,
    location_id: locationId,
    reference_type: "order",
    reference_id: orderId,
    staff_id: staffId,
  }));

  await db.from("stock_movements").insert(movements);
}

// Pure rollup: theoretical usage (what the recipes say should have been used,
// given what actually sold) vs actual usage (what the ledger says left stock)
// per ingredient, valued at last-known cost. The gap between the two GP%
// figures is the money leaking through waste, over-portioning and shrinkage —
// stock-vs-sales, as distinct from a stock-take's stock-vs-stock check.
export function buildReconciliationReport(
  from: string,
  to: string,
  netSales: number,
  ingredients: { id: number; name: string; unit: string; cost_per_unit: number }[],
  theoreticalUsage: Map<number, number>,
  actualUsage: Map<number, number>
): ReconciliationReport {
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));
  const ids = new Set<number>([...theoreticalUsage.keys(), ...actualUsage.keys()]);

  let cogsTheoretical = 0;
  let cogsActual = 0;
  const lines: ReconciliationLine[] = [];

  for (const id of ids) {
    const ing = ingredientById.get(id);
    if (!ing) continue;
    const theoretical = theoreticalUsage.get(id) || 0;
    const actual = actualUsage.get(id) || 0;
    const varianceQty = actual - theoretical;
    cogsTheoretical += theoretical * ing.cost_per_unit;
    cogsActual += actual * ing.cost_per_unit;
    lines.push({
      ingredient_id: id,
      ingredient_name: ing.name,
      unit: ing.unit,
      theoretical_usage: Math.round(theoretical * 1000) / 1000,
      actual_usage: Math.round(actual * 1000) / 1000,
      variance_qty: Math.round(varianceQty * 1000) / 1000,
      variance_value: Math.round(varianceQty * ing.cost_per_unit * 100) / 100,
    });
  }
  lines.sort((a, b) => Math.abs(b.variance_value) - Math.abs(a.variance_value));

  cogsTheoretical = Math.round(cogsTheoretical * 100) / 100;
  cogsActual = Math.round(cogsActual * 100) / 100;
  const gpTheoretical = netSales > 0 ? Math.round(((netSales - cogsTheoretical) / netSales) * 1000) / 10 : null;
  const gpActual = netSales > 0 ? Math.round(((netSales - cogsActual) / netSales) * 1000) / 10 : null;
  const gpGap = gpTheoretical != null && gpActual != null ? Math.round((gpTheoretical - gpActual) * 10) / 10 : null;

  return {
    period: { from, to },
    net_sales: netSales,
    cogs_theoretical: cogsTheoretical,
    cogs_actual: cogsActual,
    gp_theoretical: gpTheoretical,
    gp_actual: gpActual,
    gp_gap: gpGap,
    lines,
  };
}

// GET /reports/reconciliation — stock-vs-sales, only trustworthy once a
// stock-take has posted for the period (see SPEC: two different reconciliations).
// Sales and theoretical usage use the same code as Finance (lib/finance.ts,
// lib/recipes.ts), so "COGS (theoretical)" here equals Finance's recipe COGS.
export async function getReconciliationReport(businessId: number, from: string, to: string): Promise<ReconciliationReport> {
  const db = bizDb(businessId);
  const { start, end } = tradingRangeUtc(from, to);
  const [sales, book, movements, ingredients] = await Promise.all([
    getSalesData(businessId, from, to),
    loadRecipeBook(businessId),
    // Actual usage: opening + receipts - closing collapses algebraically to just
    // "everything that left the ledger other than a purchase, negated" — the
    // opening/closing balances themselves cancel out. A new ingredient's
    // opening stock isn't usage either, so it's left out too.
    allRows<{ ingredient_id: number; quantity_delta: number; reason: string | null; reference_type: string | null }>((a, b) =>
      db.from("stock_movements").select("ingredient_id, quantity_delta, reason, reference_type")
        .neq("movement_type", "purchase").gte("created_at", start).lte("created_at", end).order("id").range(a, b)),
    db.from("ingredients").select("id, name, unit, cost_per_unit").then((r) => r.data ?? []),
  ]);

  // GP is measured on our own sales, ex-VAT, after refunds — the orders the
  // recipes can cost. Delivery-platform orders aren't itemised.
  const own = sales.orders.reduce((s, o) => s + o.total, 0) - sales.refunds.reduce((s, r) => s + r.amount, 0);
  const ownVat = sales.orders.reduce((s, o) => s + o.tax, 0) - sales.refunds.reduce((s, r) => s + r.vat, 0);
  const netSales = r2(own - ownVat);

  const items = await chunked(sales.orders.map((o) => o.id), async (ids) => {
    const { data, error } = await supabase.from("order_items").select("menu_item_id, quantity").in("order_id", ids).neq("status", "cancelled");
    if (error) throw error;
    return data ?? [];
  });
  const theoreticalUsage = recipeUsage(book, items).usage;

  const actualUsage = new Map<number, number>();
  for (const m of movements) {
    if (m.reason === "Opening stock" && m.reference_type == null) continue;
    actualUsage.set(m.ingredient_id, (actualUsage.get(m.ingredient_id) || 0) - Number(m.quantity_delta));
  }

  return buildReconciliationReport(from, to, netSales, ingredients, theoreticalUsage, actualUsage);
}
