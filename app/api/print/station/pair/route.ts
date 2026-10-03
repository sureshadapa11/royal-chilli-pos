import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";
import { pairPrintStation } from "@/lib/print-station";

// A manager pairs the till laptop as the USB Print Station (lib/print-station).
// Returns the station's key once; pairing again replaces it.
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !manageAllows(session.role, "settings", req.method)) {
    return NextResponse.json({ error: "Only a manager can pair the Print Station" }, { status: 401 });
  }
  try {
    return NextResponse.json({ key: await pairPrintStation(session.businessId) });
  } catch (error) {
    console.error("Print Station pairing error:", error);
    return NextResponse.json({ error: "Failed to pair" }, { status: 500 });
  }
}
