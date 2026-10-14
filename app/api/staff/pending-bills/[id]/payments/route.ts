import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { accountsAccess } from "@/lib/accounts-access";
import { bizDb } from "@/lib/business-db";
import { getBill } from "@/lib/pending-bills";
import { addBillPayment } from "@/lib/pending-bills-save";

// Payments on a pending bill (134): POST { amount, method, date } (anyone who
// enters Daily accounts); DELETE ?payment=<id> (Super admin). Tracking only.
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canEnter) return NextResponse.json({ error: "You can view this but not record payments." }, { status: 403 });
  const id = Number((await params).id);
  const res = await addBillPayment(session.businessId, id, session.id, (await req.json().catch(() => null)) ?? {}, "staff_hub");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status ?? 400 });
  return NextResponse.json({ bill: await getBill(session.businessId, id) });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canDelete) return NextResponse.json({ error: "Only a Super admin can delete a payment." }, { status: 403 });
  const id = Number((await params).id);
  await bizDb(session.businessId).from("pending_bill_payments").delete().eq("id", Number(req.nextUrl.searchParams.get("payment"))).eq("bill_id", id);
  return NextResponse.json({ bill: await getBill(session.businessId, id) });
}
