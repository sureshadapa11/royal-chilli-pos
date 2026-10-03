import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";
import { createPosDevice, listPosDevices } from "@/lib/device-registry";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const devices = await listPosDevices(session.businessId);
    return NextResponse.json({ devices });
  } catch (error) {
    console.error("List devices error:", error);
    return NextResponse.json({ error: "Failed to load devices" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !manageAllows(session.role, "settings", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const device_name = String(body.device_name ?? "").trim();
    if (!device_name) {
      return NextResponse.json({ error: "device_name is required" }, { status: 400 });
    }

    const device = await createPosDevice(session.businessId, {
      device_name,
      serial_number: body.serial_number ? String(body.serial_number).trim() : null,
      device_fingerprint: body.device_fingerprint ? String(body.device_fingerprint).trim() : null,
      status: body.status ?? "pending",
      pairing_status: body.pairing_status ?? "unpaired",
      app_version: body.app_version ? String(body.app_version).trim() : null,
    });

    return NextResponse.json({ device }, { status: 201 });
  } catch (error) {
    console.error("Create device error:", error);
    const message = error instanceof Error ? error.message : "Failed to create device";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
