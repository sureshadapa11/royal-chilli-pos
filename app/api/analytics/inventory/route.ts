import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { tradingRangeUtc } from "@/lib/london-date";
import { allRows } from "@/lib/finance";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "analytics", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "from and to are required" }, { status: 400 });

  // Usage includes what sales deducted automatically from recipes, plus anything logged by hand.
  const { start, end } = tradingRangeUtc(from, to);
  let movements;
  try {
    movements = await allRows<{ ingredient_id: number; movement_type: string; quantity_delta: number; ingredient: unknown }>((a, b) =>
      db.from("stock_movements")
        .select("ingredient_id, movement_type, quantity_delta, ingredient:ingredients(name, unit, cost_per_unit, current_stock, reorder_level)")
        .in("movement_type", ["waste", "usage"]).gte("created_at", start).lte("created_at", end).order("id").range(a, b));
  } catch {
    return NextResponse.json({ error: "Failed to fetch stock movements" }, { status: 500 });
  }

  const days = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1);

  type Agg = { name: string; unit: string; cost_per_unit: number; current_stock: number; reorder_level: number; waste_qty: number; usage_qty: number };
  const byIngredient = new Map<number, Agg>();

  for (const m of movements) {
    const ing = m.ingredient as unknown as { name: string; unit: string; cost_per_unit: number; current_stock: number; reorder_level: number } | null;
    if (!ing) continue;
    const cur = byIngredient.get(m.ingredient_id) || { ...ing, waste_qty: 0, usage_qty: 0 };
    const qty = Math.abs(Number(m.quantity_delta));
    if (m.movement_type === "waste") cur.waste_qty += qty;
    else cur.usage_qty += qty;
    byIngredient.set(m.ingredient_id, cur);
  }

  const waste = Array.from(byIngredient.entries())
    .filter(([, v]) => v.waste_qty > 0)
    .map(([id, v]) => ({ ingredient_id: id, name: v.name, unit: v.unit, quantity: Math.round(v.waste_qty * 1000) / 1000, value: Math.round(v.waste_qty * v.cost_per_unit * 100) / 100 }))
    .sort((a, b) => b.value - a.value);

  const totalWasteValue = Math.round(waste.reduce((s, w) => s + w.value, 0) * 100) / 100;

  const forecast = Array.from(byIngredient.entries())
    .map(([id, v]) => {
      const dailyRate = (v.waste_qty + v.usage_qty) / days;
      const daysUntilReorder = dailyRate > 0 ? Math.max(0, Math.round((v.current_stock - v.reorder_level) / dailyRate)) : null;
      return { ingredient_id: id, name: v.name, unit: v.unit, current_stock: v.current_stock, daily_consumption: Math.round(dailyRate * 1000) / 1000, days_until_reorder: daysUntilReorder };
    })
    .filter((f) => f.days_until_reorder !== null)
    .sort((a, b) => (a.days_until_reorder ?? 0) - (b.days_until_reorder ?? 0));

  return NextResponse.json({ waste, total_waste_value: totalWasteValue, forecast });
}
