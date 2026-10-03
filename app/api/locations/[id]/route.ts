import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";
import { getLocation, updateLocation } from "@/lib/locations";

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const locationId = parseId((await params).id);
  if (!locationId) return NextResponse.json({ error: "Invalid location id" }, { status: 400 });

  try {
    const location = await getLocation(session.businessId, locationId);
    if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });
    return NextResponse.json({ location });
  } catch (error) {
    console.error("Get location error:", error);
    return NextResponse.json({ error: "Failed to load location" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !manageAllows(session.role, "settings", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const locationId = parseId((await params).id);
  if (!locationId) return NextResponse.json({ error: "Invalid location id" }, { status: 400 });

  try {
    const body = await req.json();
    if (body.name !== undefined && !String(body.name).trim()) {
      return NextResponse.json({ error: "Location name cannot be empty" }, { status: 400 });
    }
    const location = await updateLocation(session.businessId, locationId, {
      name: body.name !== undefined ? String(body.name).trim() : undefined,
      address: body.address,
      phone: body.phone !== undefined ? (body.phone ? String(body.phone).trim() : null) : undefined,
      email: body.email !== undefined ? (body.email ? String(body.email).trim() : null) : undefined,
      active: body.active !== undefined ? (body.active ? 1 : 0) : undefined,
    });
    return NextResponse.json({ location });
  } catch (error) {
    console.error("Update location error:", error);
    return NextResponse.json({ error: "Failed to update location" }, { status: 500 });
  }
}
