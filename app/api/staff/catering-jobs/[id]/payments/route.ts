import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { accountsAccess } from "@/lib/accounts-access";
import { bizDb } from "@/lib/business-db";
import { getJob } from "@/lib/catering-jobs";
import { addJobPayment } from "@/lib/catering-jobs-save";

// Payments towards a catering / event job (133).
//   POST { amount, method, date, note } → record a (part) payment (anyone who enters Daily accounts)
//   DELETE ?payment=<id> → remove one entered by mistake (Super admin)
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canEnter) return NextResponse.json({ error: "You can view this but not record payments." }, { status: 403 });
  const id = Number((await params).id);
  const body = await req.json().catch(() => null);
  const res = await addJobPayment(session.businessId, id, session.id, body ?? {}, "staff_hub");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status ?? 400 });
  return NextResponse.json({ job: await getJob(session.businessId, id) });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canDelete) return NextResponse.json({ error: "Only a Super admin can delete a payment." }, { status: 403 });
  const id = Number((await params).id);
  const paymentId = Number(req.nextUrl.searchParams.get("payment"));
  const { error } = await bizDb(session.businessId).from("cash_movements").delete().eq("id", paymentId).eq("job_id", id);
  if (error) return NextResponse.json({ error: "Couldn't delete the payment." }, { status: 500 });
  return NextResponse.json({ job: await getJob(session.businessId, id) });
}
