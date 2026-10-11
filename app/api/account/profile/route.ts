import { NextRequest, NextResponse } from "next/server";
import { customerBusinessId } from "@/lib/crm";
import supabase from "@/lib/supabase";
import { getCustomerSessionFromRequest } from "@/lib/customer-auth";
import { normalizeUkMobile } from "@/lib/phone";
import { findByPhone } from "@/lib/customer-match";
import { mergeCustomers } from "@/lib/customer-merge";
import { CUSTOMER_SAFE_FIELDS } from "@/lib/customers";
import { birthdayToDate } from "@/lib/birthday";

export async function PATCH(req: NextRequest) {
  try {
    const session = await getCustomerSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { name, phone, marketing_consent, birthday } = await req.json();
    const updates: Record<string, unknown> = {};

    if (name !== undefined) {
      if (!String(name).trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
      updates.name = String(name).trim();
    }
    if (phone !== undefined) {
      // Mobile is required on every account (one customer, one record).
      const cleanPhone = normalizeUkMobile(phone);
      if (!cleanPhone) {
        return NextResponse.json({ error: "Please enter a valid UK mobile number (starts with 07, 11 digits)" }, { status: 400 });
      }
      // Already on a guest record (from till or online orders)? That's them —
      // merge it in so its orders and points come across. Another person's
      // account → refuse.
      const owner = await findByPhone(await customerBusinessId(session.id), cleanPhone);
      if (owner && owner.id !== session.id) {
        const { data: me } = await supabase.from("customers").select("email").eq("id", session.id).single();
        const sameEmailOrNone = !owner.email || owner.email.toLowerCase() === (me?.email ?? "").toLowerCase();
        if (owner.has_account || !sameEmailOrNone) {
          return NextResponse.json({ error: "That mobile number is already linked to another account — call us on 020 8797 3044 and we'll sort it out" }, { status: 409 });
        }
        const merged = await mergeCustomers(session.id, owner.id, { reason: "customer added their mobile" });
        if (!merged.ok) return NextResponse.json({ error: merged.error }, { status: 500 });
      }
      updates.phone = cleanPhone;
    }
    if (birthday !== undefined) {
      // Set once by the customer (so it can't be moved for another treat); staff can change it.
      const dob = birthdayToDate(birthday?.day, birthday?.month);
      if (!dob) return NextResponse.json({ error: "Please choose a day and month" }, { status: 400 });
      const { data: me } = await supabase.from("customers").select("date_of_birth").eq("id", session.id).single();
      if (me?.date_of_birth) return NextResponse.json({ error: "Your birthday is already saved. Call us if it needs changing." }, { status: 409 });
      updates.date_of_birth = dob;
    }
    if (marketing_consent !== undefined) {
      updates.marketing_consent = !!marketing_consent;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("customers")
      .update(updates)
      .eq("id", session.id)
      .select(CUSTOMER_SAFE_FIELDS)
      .single();

    if (error) {
      // Postgres unique_violation — this phone is already on a different account.
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json({ error: "That mobile number is already linked to another account" }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, customer: data });
  } catch (error) {
    console.error("Profile update error:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
