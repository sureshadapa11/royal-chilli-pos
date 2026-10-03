import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";
import { getPosDevice, updatePosDevice, type PosDevicePairingStatus, type PosDeviceStatus } from "@/lib/device-registry";export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return NextResponse.json({ error: "Invalid device id" }, { status: 400 });
  }

  try {
    const device = await getPosDevice(session.businessId, deviceId);
    if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });
    return NextResponse.json({ device });
  } catch (error) {
    console.error("Get device error:", error);
    return NextResponse.json({ error: "Failed to load device" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !manageAllows(session.role, "settings", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return NextResponse.json({ error: "Invalid device id" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const device = await updatePosDevice(session.businessId, deviceId, {
      device_name: body.device_name ? String(body.device_name).trim() : undefined,
      serial_number: body.serial_number !== undefined ? String(body.serial_number).trim() || null : undefined,
      device_fingerprint: body.device_fingerprint !== undefined ? String(body.device_fingerprint).trim() || null : undefined,
      registration_code_hash: body.registration_code_hash !== undefined ? String(body.registration_code_hash).trim() || null : undefined,
            pairing_status: body.pairing_status ? (String(body.pairing_status) as PosDevicePairingStatus) : undefined,
      status: body.status ? (String(body.status) as PosDeviceStatus) : undefined,
      app_version: body.app_version !== undefined ? String(body.app_version).trim() || null : undefined,
      last_seen_at: body.last_seen_at ? new Date(body.last_seen_at).toISOString() : undefined,
      paired_at: body.paired_at ? new Date(body.paired_at).toISOString() : undefined,
      disabled_at: body.disabled_at ? new Date(body.disabled_at).toISOString() : undefined,
    });

    return NextResponse.json({ device });
  } catch (error) {
    console.error("Update device error:", error);
    const message = error instanceof Error ? error.message : "Failed to update device";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
