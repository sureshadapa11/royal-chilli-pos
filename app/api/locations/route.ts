import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";
import { listLocations, createLocation } from "@/lib/locations";

/**
 * GET /api/locations — List active locations for this business.
 * Requires authenticated staff.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const locations = await listLocations(session.businessId);
    return NextResponse.json({ locations });
  } catch (error) {
    console.error("List locations error:", error);
    return NextResponse.json({ error: "Failed to load locations" }, { status: 500 });
  }
}

/**
 * POST /api/locations — Create a new location.
 * Requires manager role or above.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !manageAllows(session.role, "settings", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Validate
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Location name is required" }, { status: 400 });
    }

    const location = await createLocation(session.businessId, {
      name,
      address: body.address ?? null,
      phone: body.phone ? String(body.phone).trim() : null,
      email: body.email ? String(body.email).trim() : null,
    });

    return NextResponse.json({ location }, { status: 201 });
  } catch (error) {
    console.error("Create location error:", error);
    const message = error instanceof Error ? error.message : "Failed to create location";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
