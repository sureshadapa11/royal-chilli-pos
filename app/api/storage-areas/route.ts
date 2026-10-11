import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { resolveInventoryLocation } from "@/lib/locations";
import { STORAGE_KINDS, type StorageKind } from "@/lib/batches";

// The branch's fridges, freezers and stores (migration 118). Managers (full
// Inventory) add and remove them.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "inventory", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const location = await resolveInventoryLocation(session.businessId, session.id, null, session.owner);
  if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });
  const { data, error } = await bizDb(session.businessId).from("storage_areas")
    .select("id, name, kind").eq("location_id", location.locationId).eq("active", true).order("name");
  if (error) return NextResponse.json({ error: "Failed to load storage areas" }, { status: 500 });
  return NextResponse.json({ areas: data ?? [] });
}

// POST { name, kind }
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const location = await resolveInventoryLocation(session.businessId, session.id, null, session.owner);
    if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });
    const { name, kind } = await req.json();
    const clean = typeof name === "string" ? name.trim().slice(0, 40) : "";
    if (!clean) return NextResponse.json({ error: "Give it a name, e.g. Walk-in fridge." }, { status: 400 });
    const k: StorageKind = STORAGE_KINDS.includes(kind) ? kind : "fridge";

    const { data, error } = await bizDb(session.businessId).from("storage_areas")
      .insert({ location_id: location.locationId, name: clean, kind: k, created_by: session.id })
      .select("id, name, kind").single();
    if (error?.code === "23505") return NextResponse.json({ error: `There's already a "${clean}".` }, { status: 409 });
    if (error) throw error;
    return NextResponse.json({ success: true, area: data }, { status: 201 });
  } catch (error) {
    console.error("Storage area create error:", error);
    return NextResponse.json({ error: "Failed to add the storage area" }, { status: 500 });
  }
}
