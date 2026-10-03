import { NextRequest, NextResponse } from "next/server";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { tradingRangeUtc } from "@/lib/london-date";
import { resolveInventoryLocation } from "@/lib/locations";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "inventory", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { searchParams } = new URL(req.url);
  const location = await resolveInventoryLocation(session.businessId, session.id, searchParams.get("location_id"), session.owner);
  if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });
  const ingredientId = searchParams.get("ingredient_id");
  const movementType = searchParams.get("movement_type");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = db
    .from("stock_movements")
    .select("*, ingredient:ingredients(name, unit), staff:staff!stock_movements_staff_id_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(500);
  query = query.eq("location_id", location.locationId);
  if (ingredientId) query = query.eq("ingredient_id", ingredientId);
  if (movementType) query = query.eq("movement_type", movementType);
  if (from) query = query.gte("created_at", tradingRangeUtc(from).start);
  if (to) query = query.lte("created_at", tradingRangeUtc(to).end);

  const { data, error } = await query;
  if (error) {
    console.error("Stock movements fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch stock movements" }, { status: 500 });
  }
  const flat = (data || []).map((m) => {
    const { ingredient: i, staff: s, ...rest } = m as typeof m & {
      ingredient: { name: string; unit: string } | null;
      staff: { name: string } | null;
    };
    return { ...rest, ingredient_name: i?.name ?? null, unit: i?.unit ?? null, staff_name: s?.name ?? null };
  });
  return NextResponse.json({ movements: flat });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const location = await resolveInventoryLocation(session.businessId, session.id, null, session.owner);
    if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });
    const { ingredient_id, movement_type, quantity, reason } = await req.json();
    if (!ingredient_id || !movement_type || !quantity) {
      return NextResponse.json({ error: "ingredient_id, movement_type and quantity are required" }, { status: 400 });
    }
    if (!["waste", "adjustment", "usage"].includes(movement_type)) {
      return NextResponse.json({ error: "This endpoint only records waste, adjustment, or usage — purchases are recorded via receiving a purchase order" }, { status: 400 });
    }

    if (!(await allOwned(db, "ingredients", [ingredient_id]))) {

      return NextResponse.json({ error: "That ingredient isn't this business's" }, { status: 400 });

    }


    // Waste and usage always reduce stock; a manual adjustment can go either way (client sends the signed delta).
    const delta = movement_type === "adjustment" ? Number(quantity) : -Math.abs(Number(quantity));

    const { data, error } = await db
      .from("stock_movements")
      .insert({ ingredient_id, movement_type, quantity_delta: delta, reason: reason || null, staff_id: session.id, location_id: location.locationId })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, movement: data }, { status: 201 });
  } catch (error) {
    console.error("Stock movement create error:", error);
    return NextResponse.json({ error: "Failed to record stock movement" }, { status: 500 });
  }
}
