import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { bizDb } from "@/lib/business-db";
import { issueRedemption } from "@/lib/loyalty";
import { sendApologyEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site-url";

// POST { id } — Customers → Feedback → "Send apology offer": one click gives an
// unhappy guest (a Rewards Club member) the business's apology reward (a free
// dessert, no points taken), emails it if they can be contacted, and marks the
// feedback handled. Once per feedback.
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "customers", "PATCH")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = Number((await req.json().catch(() => null))?.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Pick some feedback" }, { status: 400 });

  const db = bizDb(session.businessId);
  const { data: fb } = await db.from("guest_feedback").select("id, customer_id, contact_ok, handled_at, apology_redemption_id").eq("id", id).maybeSingle();
  if (!fb) return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
  if (!fb.customer_id) {
    return NextResponse.json({ error: "This guest isn't a Rewards Club member, so there's no account to send an offer to. Call or email them instead." }, { status: 400 });
  }
  if (fb.apology_redemption_id) return NextResponse.json({ error: "An apology offer was already sent for this feedback" }, { status: 409 });

  const { data: reward } = await db.from("loyalty_rewards").select("id, name").eq("is_apology_reward", true).eq("active", 1).maybeSingle();
  if (!reward) return NextResponse.json({ error: "No apology offer is set up. Add one in Rewards Catalog." }, { status: 400 });

  const issued = await issueRedemption(fb.customer_id, reward.id, session.id);
  if (!issued.ok) return NextResponse.json({ error: issued.error }, { status: 400 });
  const code = issued.redemption.code;

  await db.from("guest_feedback").update({
    apology_redemption_id: issued.redemption.id,
    ...(fb.handled_at ? {} : { handled_at: new Date().toISOString(), handled_by: session.id, handled_note: `Apology offer sent: ${code}` }),
  }).eq("id", fb.id);

  // Email it when they're happy to hear from us (ticked "contact me" or offers).
  // Awaited: on Vercel a send left running after the response may never happen.
  let emailed = false;
  const { data: customer } = await supabase.from("customers").select("name, email, marketing_consent").eq("id", fb.customer_id).maybeSingle();
  if (customer?.email && (fb.contact_ok || customer.marketing_consent)) {
    try {
      await sendApologyEmail(customer.email, {
        businessId: session.businessId, customerName: customer.name, offer: reward.name.replace(/^Apology:\s*/i, ""),
        code, expiresAt: String(issued.redemption.expires_at), accountUrl: `${SITE_URL}/account/loyalty`,
      });
      emailed = true;
    } catch (err) {
      console.error(`Apology email failed (feedback ${fb.id}):`, err);
    }
  }
  return NextResponse.json({ ok: true, code, emailed, customerName: customer?.name ?? null });
}
