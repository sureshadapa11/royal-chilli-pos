import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import type { SessionUser } from "./types";
import { DEFAULT_BUSINESS_ID } from "./business-id";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "royal-chilli-pos-fallback-secret-key-2024"
);

const COOKIE_NAME = "pos_session";
// "driver" (migration 091) isn't a StaffRole: drivers have no Staff Hub tabs,
// only /staff/drivers and the /api/drivers/* endpoints.
const VALID_ROLES = new Set<string>(["employee", "manager", "hr", "admin", "driver"]);

export async function createSession(user: SessionUser): Promise<string> {
  const token = await new SignJWT({
    id: user.id,
    name: user.name,
    role: user.role,
    bid: user.businessId,
    ...(user.owner ? { own: true } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(JWT_SECRET);

  return token;
}

// A staff session token carries no `type`/`purpose` marker of its own —
// unlike customer_session/password_reset in lib/customer-auth.ts, which both
// do specifically so they can't be replayed as each other. Without the same
// shape check here, any other token signed with this shared JWT_SECRET (a
// customer's 30-day login token, say) would verify successfully and get
// treated as a logged-in staff member by any route that only checks "is
// there a session" rather than also checking role. Requiring `role` to be a
// real staff role — which no other token type here ever sets — closes that.
async function verify(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] });
    const { id, name, role, bid, own } = payload;
    if (typeof id !== "number" || typeof name !== "string" || typeof role !== "string" || !VALID_ROLES.has(role)) {
      return null;
    }
    // Logins from before multi-business (and the attendance app's tokens,
    // until it's updated) don't say — they're The Royal Chilli.
    const businessId = typeof bid === "number" && Number.isInteger(bid) && bid > 0 ? bid : DEFAULT_BUSINESS_ID;
    return { id, name, role: role as SessionUser["role"], businessId, ...(own === true ? { owner: true } : {}) };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  return verify(cookieStore.get(COOKIE_NAME)?.value);
}

export async function getSessionFromRequest(
  req: NextRequest
): Promise<SessionUser | null> {
  return verify(req.cookies.get(COOKIE_NAME)?.value);
}

export function getSessionCookieOptions() {
  return {
    name: COOKIE_NAME,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 12, // 12 hours
      path: "/",
      // Set COOKIE_DOMAIN=.royalchilli.com in BOTH this app and
      // royal-chilli-attendance once they're on the subdomains — a manager
      // login in either then signs them into the other.
      ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    },
  };
}
