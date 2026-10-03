import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createBusiness, listBusinessSummaries } from "@/lib/businesses-admin";
import { bizDb } from "@/lib/business-db";

// The group owner's Businesses screen. Owner only.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session?.owner) return NextResponse.json({ error: "Only the owner can see all businesses" }, { status: 403 });
  return NextResponse.json({ businesses: await listBusinessSummaries() });
}

// POST { name, order_prefix, login_code } — add a business (not open yet, rewards scheme copied from Royal Chilli's).
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session?.owner) return NextResponse.json({ error: "Only the owner can add a business" }, { status: 403 });
  const { name, order_prefix, login_code } = await req.json().catch(() => ({}));
  const result = await createBusiness({ name: String(name ?? ""), orderPrefix: String(order_prefix ?? ""), loginCode: String(login_code ?? "") });
  if (!result.ok) return NextResponse.json({ error: result.error, field: result.field }, { status: 400 });
  await bizDb(result.value.id).from("audit_logs").insert({
    staff_id: session.id, action: "business_created", entity_type: "business", entity_id: result.value.id, changes: { name, order_prefix, login_code },
  });
  return NextResponse.json({ business: result.value }, { status: 201 });
}
