import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { londonDateStr } from "@/lib/london-date";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "inventory", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);

  const { data: ingredients } = await db.from("ingredients").select("*").eq("active", 1);
  const lowStock = (ingredients || []).filter((i) => Number(i.current_stock) <= Number(i.reorder_level));

  const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: expiringItems } = await db
    .from("purchase_order_items")
    .select("*, ingredient:ingredients(name, unit), purchase_orders!inner(business_id)")
    .eq("purchase_orders.business_id", session.businessId)
    .not("expiry_date", "is", null)
    .lte("expiry_date", sevenDaysOut)
    .gte("expiry_date", londonDateStr());

  const flatExpiring = (expiringItems || []).map((i) => {
    const { ingredient: ing, purchase_orders: _po, ...rest } = i as typeof i & { ingredient: { name: string; unit: string } | null; purchase_orders: unknown };
    void _po;
    return { ...rest, ingredient_name: ing?.name ?? null, unit: ing?.unit ?? null };
  });

  return NextResponse.json({ lowStock, expiringSoon: flatExpiring });
}
