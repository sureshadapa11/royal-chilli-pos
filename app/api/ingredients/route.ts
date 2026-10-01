import { NextRequest, NextResponse } from "next/server";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { findActiveByName } from "@/lib/unique-entry";
import { canManageInventory } from "@/lib/permissions";
import { resolveInventoryLocation } from "@/lib/locations";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageInventory(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { searchParams } = new URL(req.url);
  const location = await resolveInventoryLocation(session.businessId, session.id, searchParams.get("location_id"));
  if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });
  const lowStockOnly = searchParams.get("low_stock") === "1";
  const search = searchParams.get("search");

  let query = db
    .from("ingredients")
    .select("*, supplier:suppliers(name)")
    .eq("active", 1)
    .or(`location_id.eq.${location.locationId},location_id.is.null`)
    .order("name");
  if (search) query = query.ilike("name", `%${search}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to fetch ingredients" }, { status: 500 });

  let flat = (data || []).map((i) => {
    const { supplier: s, ...rest } = i as typeof i & { supplier: { name: string } | null };
    return { ...rest, supplier_name: s?.name ?? null };
  });
  if (lowStockOnly) flat = flat.filter((i) => Number(i.current_stock) <= Number(i.reorder_level));

  return NextResponse.json({ ingredients: flat });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !canManageInventory(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { name, unit, reorder_level, reorder_quantity, cost_per_unit, supplier_id, opening_stock } = await req.json();
    const location = await resolveInventoryLocation(session.businessId, session.id, null);
    if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });
    if (supplier_id && !(await allOwned(db, "suppliers", [supplier_id]))) return NextResponse.json({ error: "That supplier isn't this business's" }, { status: 400 });
    if (!name || !String(name).trim() || !unit) return NextResponse.json({ error: "Name and unit are required" }, { status: 400 });
    const existing = await findActiveByName("ingredients", String(name), undefined, session.businessId, location.locationId);
    if (existing) return NextResponse.json({ error: `"${existing.name}" is already an ingredient — use Adjust on it instead` }, { status: 409 });

    const { data: ingredient, error } = await db
      .from("ingredients")
      .insert({
        name: String(name).trim().replace(/\s+/g, " "), unit,
        reorder_level: reorder_level || 0,
        reorder_quantity: reorder_quantity || 0,
        cost_per_unit: cost_per_unit || 0,
        supplier_id: supplier_id || null,
        location_id: location.locationId,
      })
      .select()
      .single();
    if (error) throw error;

    if (opening_stock && Number(opening_stock) > 0) {
      await db.from("stock_movements").insert({
        ingredient_id: ingredient.id,
        movement_type: "adjustment",
        quantity_delta: Number(opening_stock),
        reason: "Opening stock",
        staff_id: session.id,
        location_id: location.locationId,
      });
    }

    const { data: fresh } = await db.from("ingredients").select("*").eq("id", ingredient.id).single();
    return NextResponse.json({ success: true, ingredient: fresh }, { status: 201 });
  } catch (error) {
    console.error("Ingredient create error:", error);
    return NextResponse.json({ error: "Failed to create ingredient" }, { status: 500 });
  }
}
