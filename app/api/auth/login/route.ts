import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";
import { createSession, getSessionCookieOptions } from "@/lib/auth";
import { isManagerRole } from "@/lib/staff-pin";
import { createTillToken, tillCookieOptions, TILL_COOKIE } from "@/lib/till-device";
import type { Staff } from "@/lib/types";
import { businessForHost, loginBusinessId, staffHome } from "@/lib/business";
import { bizDb } from "@/lib/business-db";

export async function POST(req: NextRequest) {
  try {
    const { username, password, pair_till } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("staff")
      .select("*")
      .eq("username", username.trim().toLowerCase())
      .eq("active", 1)
      .single();

    if (error || !data || !data.password_hash) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    const staff = data as Staff;
    const valid = await bcrypt.compare(password, staff.password_hash!);
    if (!valid) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    const host = req.headers.get("host");
    const businessId = await loginBusinessId(staff.id, host);
    if (businessId == null) {
      return NextResponse.json({ error: "Your account isn't set up at any business yet — ask a manager." }, { status: 403 });
    }

    const owner = (await staffHome(staff.id)).isOwner;
    const token = await createSession({
      id: staff.id,
      name: staff.name,
      role: staff.role,
      businessId,
      ...(owner ? { owner: true } : {}),
    });

    // Staff always work for their own business, whatever domain they signed
    // in on — record the domain (and whose it is) for diagnostics.
    try {
      const { error: auditError } = await bizDb(businessId).from("audit_logs").insert({
        staff_id: staff.id, action: "staff_login", entity_type: "staff", entity_id: staff.id,
        changes: { host: host?.slice(0, 255) ?? null, domain_business_id: (await businessForHost(host))?.id ?? null, business_id: businessId },
      });
      if (auditError) console.error("Login audit failed:", auditError);
    } catch (auditError) {
      console.error("Login audit failed:", auditError);
    }

    const { name: cookieName, options } = getSessionCookieOptions();

    const response = NextResponse.json({
      success: true,
      user: { id: staff.id, name: staff.name, role: staff.role, businessId },
    });

    response.cookies.set(cookieName, token, options);
    // "Set up this device as a till" — a manager pairs it once, then staff
    // sign in here with their PIN (lib/till-device.ts).
    if (pair_till && isManagerRole(staff.role)) {
      response.cookies.set(TILL_COOKIE, await createTillToken(staff.id, businessId), tillCookieOptions());
    }
    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
