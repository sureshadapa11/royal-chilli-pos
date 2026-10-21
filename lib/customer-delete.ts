import supabase from "@/lib/supabase";
import { londonDateStr } from "@/lib/london-date";

// "Delete my account" (My Account → Profile), the UK GDPR right to erasure.
// Orders and bookings are kept for the sales figures (and 6 years for tax) but
// no longer say who they were for; everything that identifies the person is
// wiped. Points and unused vouchers go, future bookings are cancelled.

// Same "upcoming" statuses as the account's Orders page: still being made or
// waiting to be collected/delivered.
const IN_PROGRESS_ORDER = ["open", "sent_to_kitchen", "ready"];
const FUTURE_BOOKING = ["pending", "confirmed", "waitlisted"];
const DELETED_NAME = "Deleted customer";

export async function deleteCustomerAccount(customerId: number): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data: customer } = await supabase
    .from("customers")
    .select("id, business_id, email, loyalty_points, merged_into, deleted_at")
    .eq("id", customerId)
    .maybeSingle();
  if (!customer || customer.merged_into || customer.deleted_at) return { ok: false, error: "Account not found", status: 404 };

  const { count: live } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .in("status", IN_PROGRESS_ORDER);
  if (live) {
    return { ok: false, error: "You have an order in progress. Once it's collected or delivered, you can delete your account.", status: 409 };
  }

  // Points to zero through the ledger, so the balance and its history agree.
  const points = Number(customer.loyalty_points ?? 0);
  if (points > 0) {
    await supabase.from("loyalty_transactions").insert({
      customer_id: customerId,
      points_delta: -points,
      reason: "account_deleted",
      reference_type: "account_deleted",
    });
  }
  await supabase.from("loyalty_redemptions").update({ status: "cancelled" }).eq("customer_id", customerId).eq("status", "issued");

  await supabase
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("customer_id", customerId)
    .in("status", FUTURE_BOOKING)
    .gte("reservation_date", londonDateStr());
  await supabase
    .from("reservations")
    .update({ customer_name: DELETED_NAME, customer_phone: null, customer_email: null, notes: null, allergy_notes: null })
    .eq("customer_id", customerId);

  await supabase
    .from("orders")
    .update({ customer_name: DELETED_NAME, customer_phone: null, customer_email: null, customer_address: null, customer_postcode: null, allergy_notes: null })
    .eq("customer_id", customerId);

  await supabase.from("customer_addresses").delete().eq("customer_id", customerId);
  await supabase.from("winback_requests").delete().eq("customer_id", customerId);
  await supabase.from("guest_feedback").update({ name: null, phone: null, email: null, customer_id: null }).eq("customer_id", customerId);
  if (customer.email) {
    await supabase.from("newsletter_subscribers").delete().eq("business_id", customer.business_id).ilike("email", customer.email.replace(/[\\%_]/g, "\\$&"));
  }

  const { error } = await supabase
    .from("customers")
    .update({
      name: DELETED_NAME,
      phone: null,
      email: null,
      password_hash: null,
      date_of_birth: null,
      address: null,
      notes: null,
      referral_code: null,
      marketing_consent: false,
      deleted_at: new Date().toISOString(),
    })
    .eq("id", customerId);
  if (error) return { ok: false, error: "Couldn't delete your account. Please call us and we'll do it for you.", status: 500 };
  return { ok: true };
}
