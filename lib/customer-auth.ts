// Customer-facing session — deliberately separate from lib/auth.ts's staff
// session: different cookie name (so a customer and a staff member can be
// logged into the same browser at once without clobbering each other) and a
// `type: "customer"` marker baked into the token as a defense-in-depth check,
// even though the distinct cookie name already prevents cross-reading.
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import type { CustomerSession } from "./types";
import supabase from "./supabase";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "royal-chilli-pos-fallback-secret-key-2024"
);

const COOKIE_NAME = "customer_session";

export async function createCustomerSession(customer: CustomerSession): Promise<string> {
  return new SignJWT({
    id: customer.id,
    name: customer.name,
    email: customer.email,
    type: "customer",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d") // customers expect to stay signed in, unlike a staff shift
    .sign(JWT_SECRET);
}

async function isDeleted(customerId: number): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("customers").select("deleted_at").eq("id", customerId).maybeSingle();
    return !error && !!data?.deleted_at;
  } catch {
    return false;
  }
}

async function fromToken(token: string | undefined): Promise<CustomerSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] });
    if (payload.type !== "customer") return null;
    // A deleted account's cookie may still be open on another device.
    // Fails open if the check itself errors, so a database hiccup doesn't
    // sign every customer out.
    if (await isDeleted(payload.id as number)) return null;
    return { id: payload.id as number, name: payload.name as string, email: payload.email as string };
  } catch {
    return null;
  }
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
  const cookieStore = await cookies();
  return fromToken(cookieStore.get(COOKIE_NAME)?.value);
}

export async function getCustomerSessionFromRequest(req: NextRequest): Promise<CustomerSession | null> {
  return fromToken(req.cookies.get(COOKIE_NAME)?.value);
}

// Short-lived, single-purpose token for the forgot-password email link —
// same JWT_SECRET/library as the session above, but a distinct `type` so a
// leaked reset link can never be replayed as a login session (or vice
// versa), and a much shorter expiry than the 30-day session.
export async function createPasswordResetToken(customerId: number): Promise<string> {
  return new SignJWT({ id: customerId, type: "password_reset" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(JWT_SECRET);
}

export async function verifyPasswordResetToken(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] });
    if (payload.type !== "password_reset") return null;
    return payload.id as number;
  } catch {
    return null;
  }
}

export function getCustomerSessionCookieOptions() {
  return {
    name: COOKIE_NAME,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    },
  };
}
