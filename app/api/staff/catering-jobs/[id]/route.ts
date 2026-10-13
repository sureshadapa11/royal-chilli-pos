import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { accountsAccess } from "@/lib/accounts-access";
import { bizDb } from "@/lib/business-db";
import { getJob } from "@/lib/catering-jobs";
import { parseJob } from "@/lib/catering-jobs-save";

// One catering / event job (133).
//   PATCH { …job fields } → change it (Super admin)
//   PATCH { cancelled: true|false } → cancel / bring back (Super admin)
//   DELETE → remove a job entered by mistake (Super admin; only with no payments)
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canCorrect) return NextResponse.json({ error: "Only a Super admin can change a job." }, { status: 403 });
  const id = Number((await params).id);
  const job = await getJob(session.businessId, id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const db = bizDb(session.businessId);
  if (typeof body?.cancelled === "boolean" && Object.keys(body).length === 1) {
    await db.from("catering_jobs").update({ cancelled: body.cancelled, updated_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ job: await getJob(session.businessId, id) });
  }
  const fields = parseJob(body);
  if ("error" in fields) return NextResponse.json({ error: fields.error }, { status: 400 });
  if (fields.total < job.paid) return NextResponse.json({ error: `£${job.paid.toFixed(2)} has already been paid, so the total can't be less.` }, { status: 400 });
  await db.from("catering_jobs").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ job: await getJob(session.businessId, id) });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canDelete) return NextResponse.json({ error: "Only a Super admin can delete a job." }, { status: 403 });
  const id = Number((await params).id);
  const job = await getJob(session.businessId, id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.payments.length) return NextResponse.json({ error: "This job has payments. Cancel it instead, or delete its payments first." }, { status: 400 });
  await bizDb(session.businessId).from("catering_jobs").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
