import { NextRequest, NextResponse } from "next/server";
import { loadRecipeBook } from "@/lib/recipes";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { getPaidOrdersInRange, getItemSalesInRange } from "@/lib/analytics";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "analytics", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "from and to are required" }, { status: 400 });

  const orders = await getPaidOrdersInRange(session.businessId, from, to);
  const items = await getItemSalesInRange(orders.map((o) => o.id));

  const byItem = new Map<string, { menu_item_id: number | null; quantity_sold: number; revenue: number }>();
  for (const i of items) {
    const cur = byItem.get(i.item_name) || { menu_item_id: i.menu_item_id, quantity_sold: 0, revenue: 0 };
    cur.quantity_sold += i.quantity;
    cur.revenue += Number(i.item_price) * i.quantity;
    byItem.set(i.item_name, cur);
  }

  // Recipe cost per portion, for profit margin — the shared recipe
  // calculator (lib/recipes.ts), so it matches Finance and stock depletion.
  const book = await loadRecipeBook(session.businessId);
  const costByMenuItem = new Map<number, number>([...book].map(([menuItemId, r]) => [menuItemId, r.costPerPortion]));

  const ranked = Array.from(byItem.entries())
    .map(([item_name, v]) => {
      const revenue = Math.round(v.revenue * 100) / 100;
      const unitPrice = v.quantity_sold > 0 ? v.revenue / v.quantity_sold : 0;
      const recipeCost = v.menu_item_id ? costByMenuItem.get(v.menu_item_id) : undefined;
      const marginPct = recipeCost !== undefined && unitPrice > 0 ? Math.round(((unitPrice - recipeCost) / unitPrice) * 1000) / 10 : null;
      return { item_name, quantity_sold: v.quantity_sold, revenue, margin_pct: marginPct };
    })
    .sort((a, b) => b.quantity_sold - a.quantity_sold);

  const bestSellers = ranked.slice(0, 10);
  const worstSellers = [...ranked].sort((a, b) => a.quantity_sold - b.quantity_sold).slice(0, 10);

  return NextResponse.json({ best_sellers: bestSellers, worst_sellers: worstSellers });
}
