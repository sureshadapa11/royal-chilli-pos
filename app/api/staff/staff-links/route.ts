import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getSessionFromRequest } from "@/lib/auth";
import { isManagerRole } from "@/lib/staff-pin";
import { staffLinkToken } from "@/lib/staff-links";

// Settings → Staff links: the business's Day End / Cash In-Out link and its QR.
// GET → the link; POST → make a new one (the old link stops working).
async function reply(req: NextRequest, rotate: boolean) {
  const session = await getSessionFromRequest(req);
  if (!session || !(session.owner || isManagerRole(session.role))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const token = await staffLinkToken(session.businessId, rotate);
  const url = `${req.nextUrl.origin}/l/${token}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).catch(() => null);
  return NextResponse.json({ url, qr });
}

export const GET = (req: NextRequest) => reply(req, false);
export const POST = (req: NextRequest) => reply(req, true);
