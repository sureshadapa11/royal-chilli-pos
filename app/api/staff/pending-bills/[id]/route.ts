import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { accountsAccess } from "@/lib/accounts-access";
import { bizDb } from "@/lib/business-db";
import { getBill } from "@/lib/pending-bills";
import { parseBill } from "@/lib/pending-bills-save";

// One pending bill (134): PATCH fields or { cancelled } (Super admin);
// DELETE one entered by mistake (Super admin; payments go with it).
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canCorrect) return NextResponse.json({ error: "Only a Super admin can change a bill." }, { status: 403 });
  const id = Number((await params).id);
  const bill = await getBill(session.businessId, id);
  if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const db = bizDb(session.businessId);
  if (typeof body?.cancelled === "boolean" && Object.keys(body).length === 1) {
    await db.from("pending_bills").update({ cancelled: body.cancelled, updated_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ bill: await getBill(session.businessId, id) });
  }
  const fields = parseBill(body);
  if ("error" in fields) return NextResponse.json({ error: fields.error }, { status: 400 });
  if (fields.amount < bill.paid) return NextResponse.json({ error: `£${bill.paid.toFixed(2)} has already been paid, so the bill can't be less.` }, { status: 400 });
  await db.from("pending_bills").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ bill: await getBill(session.businessId, id) });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canDelete) return NextResponse.json({ error: "Only a Super admin can delete a bill." }, { status: 403 });
  const id = Number((await params).id);
  if (!(await getBill(session.businessId, id))) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  await bizDb(session.businessId).from("pending_bills").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
