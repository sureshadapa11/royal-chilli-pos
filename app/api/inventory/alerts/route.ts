import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { londonDateStr } from "@/lib/london-date";
import { expiryStatus, useFirstUntil } from "@/lib/batches";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "inventory", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);

  const { data: ingredients } = await db.from("ingredients").select("*").eq("active", 1);
  const lowStock = (ingredients || []).filter((i) => Number(i.current_stock) <= Number(i.reorder_level));

  // Dated stock still on the shelf with a use-by today or tomorrow, or past it
  // (batches, migration 118).
  const today = londonDateStr();
  const { data: dated } = await db
    .from("inventory_batches")
    .select("id, expiry_date, remaining_qty, ingredient:ingredients(name, unit)")
    .gt("remaining_qty", 0)
    .lte("expiry_date", useFirstUntil(today))
    .order("expiry_date");

  const flatExpiring = (dated || []).map((b) => {
    const { ingredient: ing, ...rest } = b as unknown as typeof b & { ingredient: { name: string; unit: string } | null };
    return { ...rest, ingredient_name: ing?.name ?? null, unit: ing?.unit ?? null, status: expiryStatus(b.expiry_date, today) };
  });

  return NextResponse.json({ lowStock, expiringSoon: flatExpiring });
}
