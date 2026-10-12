import { NextRequest, NextResponse } from "next/server";
import { accountsAccess } from "@/lib/accounts-access";
import { tradingRangeUtc } from "@/lib/london-date";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb } from "@/lib/business-db";
import { tillFigures } from "@/lib/daily-accounts";
import { DAILY_KEYS, isComputedField, platformCommission } from "@/lib/daily-accounts-fields";
import { getCardFeeRate } from "@/lib/daily-figures";

// The manager's day-end accounts sheet (Staff Hub → Daily accounts), one per
// business per trading day. Anyone with the Finance tab enters it; once
// submitted, only an admin or the owner can change it (every save is logged).

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLUMNS = ["trading_date", ...DAILY_KEYS, "notes", "status", "submitted_at", "updated_at"].join(", ");

// Who may enter, correct or see figures: lib/accounts-access.ts (Super admin
// corrects a submitted day; Supervisor views only; Managers enter).
const canUnlock = (s: { role: string; owner?: boolean }) => accountsAccess(s).canCorrect;

/** GET ?date=YYYY-MM-DD → the saved sheet (or null) and the till's figures to pre-fill it. */
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const access = session ? accountsAccess(session) : null;
  if (!session || !access?.tabs.includes("day")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!DATE.test(date)) return NextResponse.json({ error: "Pick a date" }, { status: 400 });

  const db = bizDb(session.businessId);
  const [{ data: saved, error }, till, cardFeeRate, { data: moves }, tillOut] = await Promise.all([
    db.from("daily_accounts").select(COLUMNS).eq("trading_date", date).maybeSingle(),
    tillFigures(session.businessId, date),
    getCardFeeRate(session.businessId),
    db.from("cash_movements").select("direction, amount").eq("movement_date", date).eq("method", "cash"),
    tillPaidOutOn(session.businessId, date),
  ]);
  // Cash in / out of the drawer that day (staff link + the till's Cash Out), for the cash check.
  const sum = (dir: string) => Math.round((moves ?? []).filter((m) => m.direction === dir).reduce((s, m) => s + Number(m.amount), 0) * 100) / 100;
  const cashMoves = { moneyIn: sum("in"), moneyOut: Math.round((sum("out") + tillOut) * 100) / 100 };
  if (error) return NextResponse.json({ error: "Couldn't load the day" }, { status: 500 });
  const submitted = (saved as { status?: string } | null)?.status === "submitted";
  return NextResponse.json({
    date, saved, till, cardFeeRate,
    // The cash check is for those who see figures (not Managers).
    cashMoves: access.seeFigures ? cashMoves : null,
    locked: !access.canEnter || (submitted && !canUnlock(session)), canUnlock: canUnlock(session),
    viewOnly: !access.canEnter,
  });
}

/** PUT { date, values: { z_report: 123.45, … }, notes, submit } — save a draft, or submit. */
export async function PUT(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canEnter) return NextResponse.json({ error: "You can view Daily accounts but not change them." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const date = String(body?.date ?? "");
  if (!DATE.test(date)) return NextResponse.json({ error: "Pick a date" }, { status: 400 });

  const db = bizDb(session.businessId);
  const { data: existing } = await db.from("daily_accounts").select("status").eq("trading_date", date).maybeSingle();
  if (existing?.status === "submitted" && !canUnlock(session)) {
    return NextResponse.json({ error: "This day has been submitted. Ask a Super admin to change it." }, { status: 403 });
  }

  const values: Record<string, number | null> = {};
  for (const k of DAILY_KEYS) {
    if (isComputedField(k)) continue;
    const raw = body?.values?.[k];
    if (raw === null || raw === undefined || raw === "") { values[k] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
      return NextResponse.json({ error: "Amounts must be zero or more", field: k }, { status: 400 });
    }
    values[k] = Math.round(n * 100) / 100;
  }
  // Saved as the platforms' commission total; the card fee is added when shown.
  values.commission = platformCommission(values);
  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 1000) || null : null;
  const submit = body?.submit === true;
  const now = new Date().toISOString();

  const row = {
    trading_date: date, ...values, notes, updated_by: session.id, updated_at: now,
    status: submit || existing?.status === "submitted" ? "submitted" : "draft",
    ...(submit && existing?.status !== "submitted" ? { submitted_by: session.id, submitted_at: now } : {}),
  };
  const { error } = await db.from("daily_accounts").upsert(row, { onConflict: "business_id,trading_date" });
  if (error) return NextResponse.json({ error: "Couldn't save" }, { status: 500 });

  await db.from("audit_logs").insert({
    staff_id: session.id,
    action: existing?.status === "submitted" ? "daily_accounts_corrected" : submit ? "daily_accounts_submitted" : "daily_accounts_saved",
    entity_type: "daily_accounts", entity_id: null,
    changes: { date, values, notes },
  });
  return NextResponse.json({ ok: true, status: row.status });
}

/** The till's Cash Out on that trading day's shifts (0 while the till isn't used). */
async function tillPaidOutOn(businessId: number, date: string): Promise<number> {
  const db = bizDb(businessId);
  const { start, end } = tradingRangeUtc(date);
  const { data: periods } = await db.from("work_periods").select("id").gte("opened_at", start).lte("opened_at", end);
  if (!periods?.length) return 0;
  const { data } = await db.from("cash_paid_outs").select("amount").in("work_period_id", periods.map((p) => p.id));
  return Math.round((data ?? []).reduce((s, p) => s + Number(p.amount), 0) * 100) / 100;
}
