import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";
import { createSession, getSessionCookieOptions } from "@/lib/auth";
import type { Staff } from "@/lib/types";
import { businessByLoginCode, businessForHost, getBusiness, loginBusinessId, staffHome } from "@/lib/business";
import { appUrl } from "@/lib/app-hosts";

// One message for an unknown username, a wrong password or the wrong business,
// so the sign-in never reveals which usernames exist.
const BAD_LOGIN = "Username or password is incorrect. If you've forgotten your details, contact your manager for account recovery.";
import { bizDb } from "@/lib/business-db";

export async function POST(req: NextRequest) {
  try {
    const { username, password, business_code } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password required" },
        { status: 400 }
      );
    }

    // The business code typed at the shared sign-in (crewportal): staff must
    // belong to that business. Without one, the address decides as before.
    const codeBusiness = business_code ? await businessByLoginCode(String(business_code)) : null;
    if (business_code && !codeBusiness) {
      return NextResponse.json({ error: "Business code not found. Check it with your manager." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("staff")
      .select("*")
      .eq("username", username.trim().toLowerCase())
      .eq("active", 1)
      .single();

    if (error || !data || !data.password_hash) {
      return NextResponse.json({ error: BAD_LOGIN }, { status: 401 });
    }

    const staff = data as Staff;
    const valid = await bcrypt.compare(password, staff.password_hash!);
    if (!valid) {
      return NextResponse.json({ error: BAD_LOGIN }, { status: 401 });
    }

    const home = await staffHome(staff.id);
    const owner = home.isOwner;
    // Wrong business for the code typed: same message as a wrong password.
    if (codeBusiness && !owner && home.businessId !== codeBusiness.id) {
      return NextResponse.json({ error: BAD_LOGIN }, { status: 401 });
    }

    // Front House and Kitchen only use their PIN, on a paired till / kitchen
    // screen — never a password sign-in here, which would open the POS on any
    // device. Their own things (clock-in, rota, payslips) are in their
    // business's attendance app. The exception: staff who "Can deliver" sign
    // in on their phone for My deliveries (and nothing else).
    const frontLine = staff.role === "employee" || staff.role === "kitchen";
    const deliverer = (frontLine && staff.can_deliver === true) || (staff.role as string) === "driver";
    if (frontLine && !deliverer) {
      const own = home.businessId != null ? await getBusiness(home.businessId).catch(() => null) : null;
      const attendance = appUrl(own?.domain, "attendance")?.replace(/^https:\/\//, "");
      return NextResponse.json(
        { error: `This sign-in is for managers. Use your attendance app${attendance ? ` (${attendance})` : ""} for clock-in, rota and payslips, and your PIN on the ${staff.role === "kitchen" ? "kitchen screen" : "till"}.` },
        { status: 403 }
      );
    }

    const host = req.headers.get("host");
    const businessId = owner && codeBusiness ? codeBusiness.id : await loginBusinessId(staff.id, host);
    if (businessId == null) {
      return NextResponse.json({ error: "Your account isn't set up at any business yet — ask a manager." }, { status: 403 });
    }

    const token = await createSession({
      id: staff.id,
      name: staff.name,
      role: staff.role,
      businessId,
      ...(owner ? { owner: true } : {}),
      ...(deliverer ? { deliver: true } : {}),
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

    const { name: cookieName, options } = getSessionCookieOptions(req.headers.get("host"));

    const response = NextResponse.json({
      success: true,
      user: { id: staff.id, name: staff.name, role: staff.role, businessId },
    });

    response.cookies.set(cookieName, token, options);
    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
