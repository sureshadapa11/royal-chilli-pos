import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { getSessionFromRequest } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { appUrl } from "@/lib/app-hosts";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "royal-chilli-pos-fallback-secret-key-2024"
);

// One-time login handoff into the Attendance app's Staff Hub sidebar link:
// mints a short-lived token (same shared secret both apps already use) and
// redirects there to consume it, so a manager/HR/admin already signed in
// here never sees that app's own login screen.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  const token = await new SignJWT({ id: session.id, name: session.name, role: session.role, bid: session.businessId, ...(session.owner ? { own: true } : {}), purpose: "sso" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(JWT_SECRET);

  // This business's own attendance.<domain> once its subdomains are live,
  // else the shared attendance address.
  const business = await getBusiness(session.businessId).catch(() => null);
  const attendanceUrl =
    appUrl(business?.domain, "attendance") ??
    (process.env.NEXT_PUBLIC_ATTENDANCE_URL || "https://royal-chilli-attendance.vercel.app");
  return NextResponse.redirect(`${attendanceUrl}/api/sso/consume?token=${encodeURIComponent(token)}`);
}
