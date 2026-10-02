import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageStaff } from "@/lib/permissions";
import {
  getPosDevice,
  updatePosDevice,
  type PosDevicePairingStatus,
  type PosDeviceStatus,
} from "@/lib/device-registry";

const PAIRING_STATUSES: PosDevicePairingStatus[] = ["unpaired", "pending", "paired"];
const DEVICE_STATUSES: PosDeviceStatus[] = ["pending", "paired", "active", "offline", "disabled", "maintenance"];

// ... GET stays exactly as it is ...

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageStaff(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return NextResponse.json({ error: "Invalid device id" }, { status: 400 });
  }

  try {
    const body = await req.json();

    let pairing_status: PosDevicePairingStatus | undefined;
    if (body.pairing_status) {
      const value = String(body.pairing_status);
      if (!PAIRING_STATUSES.includes(value as PosDevicePairingStatus)) {
        return NextResponse.json({ error: "Invalid pairing_status" }, { status: 400 });
      }
      pairing_status = value as PosDevicePairingStatus;
    }

    let status: PosDeviceStatus | undefined;
    if (body.status) {
      const value = String(body.status);
      if (!DEVICE_STATUSES.includes(value as PosDeviceStatus)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      status = value as PosDeviceStatus;
    }

    const device = await updatePosDevice(session.businessId, deviceId, {
      device_name: body.device_name ? String(body.device_name).trim() : undefined,
      serial_number: body.serial_number !== undefined ? String(body.serial_number).trim() || null : undefined,
      device_fingerprint: body.device_fingerprint !== undefined ? String(body.device_fingerprint).trim() || null : undefined,
      registration_code_hash: body.registration_code_hash !== undefined ? String(body.registration_code_hash).trim() || null : undefined,
      pairing_status,
      status,
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
