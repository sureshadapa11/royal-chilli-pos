import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageInventory } from "@/lib/permissions";
import { resolveInventoryLocation } from "@/lib/locations";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageInventory(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { searchParams } = new URL(req.url);
  const location = await resolveInventoryLocation(session.businessId, session.id, searchParams.get("location_id"), session.owner);
  if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });
  const { data, error } = await db
    .from("stock_takes")
    .select("*, counted_staff:staff!stock_takes_counted_by_fkey(name)")
    .eq("location_id", location.locationId)
    .order("opened_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Failed to fetch stock takes" }, { status: 500 });

  const flat = (data || []).map((st) => {
    const { counted_staff: s, ...rest } = st as typeof st & { counted_staff: { name: string } | null };
    return { ...rest, counted_by_name: s?.name ?? null };
  });
  return NextResponse.json({ stockTakes: flat });
}

// Opens a take and snapshots current_stock per active ingredient as system_qty —
// snapshotting is essential: sales keep depleting stock during the count, so
// counts get compared against a frozen baseline, not a moving one.
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !canManageInventory(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const body = await req.json().catch(() => ({}));
    const requestedLocationId = body && typeof body === "object" ? body.location_id : null;
    const resolvedLocation = await resolveInventoryLocation(
      session.businessId,
      session.id,
      requestedLocationId == null ? null : String(requestedLocationId),
      session.owner,
    );
    if ("error" in resolvedLocation) {
      return NextResponse.json({ error: resolvedLocation.error }, { status: resolvedLocation.status });
    }

    const { data: stockTake, error: stErr } = await db
      .from("stock_takes")
      .insert({ location_id: resolvedLocation.locationId, counted_by: session.id })
      .select()
      .single();
    if (stErr) throw stErr;

    const { data: ingredients, error: ingErr } = await db
      .from("ingredients")
      .select("id, current_stock")
      .eq("active", 1)
      .or(`location_id.eq.${resolvedLocation.locationId},location_id.is.null`);
    if (ingErr) throw ingErr;

    if ((ingredients || []).length > 0) {
      const lineRows = (ingredients || []).map((i) => ({
        stock_take_id: stockTake.id,
        ingredient_id: i.id,
        system_qty: i.current_stock,
      }));
      const { error: lineErr } = await db.from("stock_take_lines").insert(lineRows);
      if (lineErr) throw lineErr;
    }

    return NextResponse.json({ success: true, stockTake }, { status: 201 });
  } catch (error) {
    console.error("Stock take open error:", error);
    return NextResponse.json({ error: "Failed to open stock take" }, { status: 500 });
  }
}
