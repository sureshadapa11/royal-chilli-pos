import { NextRequest, NextResponse } from "next/server";
import { websiteBusinessId } from "@/lib/business";
import { signupCustomer } from "@/lib/customers";
import { createCustomerSession, getCustomerSessionCookieOptions } from "@/lib/customer-auth";
import { isValidEmail } from "@/lib/utils";
import supabase from "@/lib/supabase";
import { birthdayToDate } from "@/lib/birthday";

export async function POST(req: NextRequest) {
  try {
    const { name, email, phone, password, marketingConsent, referralCode, birthday } = await req.json();

    if (!name?.trim() || !email?.trim() || !password) {
      return NextResponse.json({ error: "Name, email and password are required" }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
    }
    if (String(password).length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const result = await signupCustomer(await websiteBusinessId(req.headers.get("host")), name, email, password, !!marketingConsent, typeof referralCode === "string" ? referralCode : null, typeof phone === "string" ? phone : null);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    // Optional birthday (day + month) for the birthday treat — never replaces one already on file.
    const dob = birthdayToDate(birthday?.day, birthday?.month);
    if (dob) await supabase.from("customers").update({ date_of_birth: dob }).eq("id", result.customer.id).is("date_of_birth", null);

    const token = await createCustomerSession({ id: result.customer.id, name: result.customer.name, email: result.customer.email! });
    const { name: cookieName, options } = getCustomerSessionCookieOptions();

    const response = NextResponse.json({ success: true, customer: { id: result.customer.id, name: result.customer.name, email: result.customer.email } });
    response.cookies.set(cookieName, token, options);
    return response;
  } catch (error) {
    console.error("Customer signup error:", error);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}
