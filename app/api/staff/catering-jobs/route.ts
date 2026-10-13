import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { accountsAccess } from "@/lib/accounts-access";
import { bizDb } from "@/lib/business-db";
import { listJobs, getJob } from "@/lib/catering-jobs";
import { addJobPayment, parseJob } from "@/lib/catering-jobs-save";

// Daily accounts → Catering & events (133). GET ?month=YYYY-MM → jobs still
// owed money + that month's jobs. POST → a new job, with an optional first
// payment (deposit) taken there and then.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).tabs.includes("jobs")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Pick a month" }, { status: 400 });
  return NextResponse.json(await listJobs(session.businessId, month), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canEnter) return NextResponse.json({ error: "You can view this but not add jobs." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const job = parseJob(body);
  if ("error" in job) return NextResponse.json({ error: job.error }, { status: 400 });
  const db = bizDb(session.businessId);
  const { data, error } = await db.from("catering_jobs").insert({ ...job, created_by: session.id }).select("id").single();
  if (error || !data) return NextResponse.json({ error: "Couldn't save the job. Please try again." }, { status: 500 });
  if (Number(body?.deposit) > 0) {
    const paid = await addJobPayment(session.businessId, data.id, session.id, { amount: body.deposit, method: body.deposit_method, date: body.deposit_date, note: "Deposit" }, "staff_hub");
    if ("error" in paid) return NextResponse.json({ job: await getJob(session.businessId, data.id), warning: `Job saved, but the deposit wasn't: ${paid.error}` });
  }
  return NextResponse.json({ job: await getJob(session.businessId, data.id) });
}
