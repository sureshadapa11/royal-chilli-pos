import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { linkStaff, payableStaff } from "@/lib/staff-links";
import { payableJobs } from "@/lib/catering-jobs";
import { payableBills } from "@/lib/pending-bills";
import { lastFloat } from "@/lib/till-float";
import { tradingDayStr } from "@/lib/london-date";
import { addDays } from "@/lib/admin-dashboard";

// POST { pin } → { name, staff, suppliers }: the form shows "✓ Anusha", and —
// only once the PIN is right — the names to pick for wages / advances and
// supplier payments. Names only — the one figure is the float the last Day End
// left in the till (agreed 2026-10-16), to prefill tonight's opening and float.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const who = await linkStaff(token, body?.pin);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const db = bizDb(who.businessId);
  const [staff, { data: suppliers }, jobs, bills, float] = await Promise.all([
    payableStaff(who.businessId),
    db.from("suppliers").select("id, name").order("name"),
    payableJobs(who.businessId),
    payableBills(who.businessId),
    lastFloat(db, addDays(tradingDayStr(), 1)),
  ]);
  return NextResponse.json({ name: who.staff.name, staff, suppliers: suppliers ?? [], jobs: jobs.map((j) => ({ id: j.id, name: j.label })), bills: bills.map((b) => ({ id: b.id, name: b.name })), float });
}
