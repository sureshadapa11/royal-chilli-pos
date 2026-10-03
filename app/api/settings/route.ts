import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";
import { getBusinessSettings, saveBusinessSettings } from "@/lib/business-settings";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !manageAllows(session.role, "settings", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // This business's own settings (Settings → General).
  const settings = await getBusinessSettings(session.businessId).catch(() => null);
  if (!settings) return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !manageAllows(session.role, "settings", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const updates = await req.json();
    await saveBusinessSettings(session.businessId, updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Settings update error:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
