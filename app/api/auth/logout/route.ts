import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { tillFromRequest } from "@/lib/till-device";

// Signs the person out. A paired till stays paired, so the next person just
// enters their PIN (/pin); `till` tells the page where to go.
export async function POST(req: NextRequest) {
  const till = await tillFromRequest(req);
  const response = NextResponse.json({ success: true, till: !!till });
  clearSessionCookie(response, req.headers.get("host"));
  return response;
}
