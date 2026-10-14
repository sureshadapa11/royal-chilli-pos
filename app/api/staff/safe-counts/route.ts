import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { accountsAccess } from "@/lib/accounts-access";
import { bizDb } from "@/lib/business-db";
import { tradingDayStr } from "@/lib/london-date";

// POST { amount, note? } — "Count the Safe" (136, agreed 2026-10-14): anyone
// who enters Daily accounts (managers such as Hari, Super admin) types what's
// in the Safe. A blind count — the reply never says what was expected; the
// Super admin sees the difference in the Cash book.
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canEnter) return NextResponse.json({ error: "You can't count the Safe." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const amount = Number(String(body?.amount ?? "").replace(/[£,\s]/g, ""));
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return NextResponse.json({ error: "Enter the amount in the Safe." }, { status: 400 });
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 200) || null : null;
  const { error } = await bizDb(session.businessId).from("safe_counts").insert({
    count_date: tradingDayStr(), amount: Math.round(amount * 100) / 100, note, counted_by: session.id,
  });
  if (error) return NextResponse.json({ error: "Couldn't save the count. Please try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
