import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { createSession, getSessionCookieOptions } from "@/lib/auth";
import type { SessionUser } from "@/lib/types";
import { getBusiness, staffHome } from "@/lib/business";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "royal-chilli-pos-fallback-secret-key-2024"
);

// Consumes a one-time login handoff token minted by the Attendance app's
// "Staff Hub" sidebar link, so a manager/HR/admin already signed in over
// there lands here already logged in — no separate login screen.
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/login", req.url));

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] });
    if (payload.purpose !== "sso") throw new Error("not an sso handoff token");
    if (!Number.isInteger(payload.id) || Number(payload.id) < 1) throw new Error("invalid staff id");
    if (!Number.isInteger(payload.bid) || Number(payload.bid) < 1) throw new Error("invalid business id");
    const businessId = Number(payload.bid);
    if (!(await getBusiness(businessId))) throw new Error("unknown business");
    const home = await staffHome(Number(payload.id));
    const isOwner = payload.own === true;
    if (home.isOwner !== isOwner || (!isOwner && home.businessId !== businessId)) {
      throw new Error("staff member is not assigned to this business");
    }

    const user: SessionUser = {
      id: payload.id as number,
      name: payload.name as string,
      role: payload.role as SessionUser["role"],
      businessId,
      ...(isOwner ? { owner: true } : {}),
    };
    const sessionToken = await createSession(user);
    const { name: cookieName, options } = getSessionCookieOptions(req.headers.get("host"));

    // Employees don't have a Staff Hub — land them on the till instead.
    const destination = user.role === "employee" ? "/pos" : "/staff";
    const response = NextResponse.redirect(new URL(destination, req.url));
    response.cookies.set(cookieName, sessionToken, options);
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
}
