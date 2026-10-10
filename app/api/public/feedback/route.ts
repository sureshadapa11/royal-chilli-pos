import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { websiteBusinessId } from "@/lib/business";
import { findMember } from "@/lib/customer-match";
import { parseFeedback } from "@/lib/feedback";

// POST — a guest's "How was your meal?" (website, table QR or receipt QR).
// Linked to their customer record when the mobile or email matches one; a
// new customer is never created from feedback. 1–3 stars appear in the Staff
// Hub's Notifications and Customers → Feedback for someone to call back.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    // Bots fill every field; people never see this one.
    if (body?.website) return NextResponse.json({ ok: true });
    const parsed = parseFeedback(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const f = parsed.value;

    const businessId = await websiteBusinessId(req.headers.get("host"), req.nextUrl.searchParams.get("b"));
    const match = f.phone || f.email ? await findMember(businessId, f.phone, f.email) : { kind: "none" as const };
    const customerId = match.kind === "match" ? match.member.id : null;

    const { error } = await bizDb(businessId).from("guest_feedback").insert({ ...f, customer_id: customerId });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Feedback error:", error);
    return NextResponse.json({ error: "Couldn't send your feedback. Please try again." }, { status: 500 });
  }
}
