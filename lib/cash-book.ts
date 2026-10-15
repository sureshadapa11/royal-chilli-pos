import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { allRows } from "@/lib/finance";
import { londonDateStr, tradingRangeUtc } from "@/lib/london-date";
import { cashCategoryLabel } from "@/lib/cash-categories";
import { getBusinessSetting } from "@/lib/business-settings";

/**
 * The day both cash books start from: the business setting cash_book_start
 * (Royal Chilli: 2026-10-01 — September was testing), otherwise the beginning.
 */
async function bookStart(businessId: number): Promise<string> {
  const v = String((await getBusinessSetting(businessId, "cash_book_start")) ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "2000-01-01";
}

// The Cash Books (Staff Hub → Daily accounts → Cash book, agreed 2026-10-12,
// like the INSOMNIA sheet; split into Till and Safe 2026-10-14):
//
// 🧾 TILL — the cash drawer, day by day, from the first Day End's opening:
//   Opening (typed — the float changes — or carried)
//   + cash sales (Day End "Cash")   + Till cash Money IN
//   − Till cash Money OUT           − till Cash Out
//   = Expected  → Counted → Variance (counted − expected)
//   − Cash taken to Safe (after the count)  → what's left for tomorrow
//
// 🔒 SAFE — cash that doesn't go through the till, from £0 on the same start:
//   + Takings from till (the Day End's "Cash taken to Safe")
//   + Safe cash Money IN (owner, catering / events, other income, advance repaid)
//   − Safe cash Money OUT (wages, advances, bills, paid into bank, given to owner)
//   = running balance; a Safe count shows counted − expected.
// Only cash: card / bank transfer entries are in neither book.

export type BookLine = {
  kind: "opening" | "sales" | "in" | "out" | "till_out" | "bank" | "takings" | "count";
  label: string;
  by: string | null;
  inAmount: number;
  outAmount: number;
  balance: number;
};

export type BookDay = {
  date: string;
  entered: boolean;               // a Day End was entered for this day
  opening: number | null;
  /** The typed opening differs from what the last day left (counted or expected). */
  openingDiff: number | null;
  lines: BookLine[];
  expected: number | null;
  counted: number | null;
  variance: number | null;
  /** What the next day carries on from. */
  carry: number | null;
};

export type DayInput = {
  date: string;
  dayEnd: { opening: number | null; cash: number | null; bankIn: number | null; closing: number | null; by: string | null } | null;
  moves: { direction: "in" | "out"; amount: number; label: string; by: string | null }[];
  tillOut: { amount: number; reason: string; by: string | null }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Builds the book from each day's entries (pure, so it can be tested). `carryIn` = the balance left before the first day. */
export function buildCashBook(days: DayInput[], carryIn: number | null): BookDay[] {
  let carry = carryIn;
  const out: BookDay[] = [];
  for (const d of days) {
    const de = d.dayEnd;
    const opening = de?.opening ?? carry;
    const lines: BookLine[] = [];
    let bal = opening ?? 0;
    const push = (kind: BookLine["kind"], label: string, by: string | null, inAmount: number, outAmount: number) => {
      bal = r2(bal + inAmount - outAmount);
      lines.push({ kind, label, by, inAmount: r2(inAmount), outAmount: r2(outAmount), balance: bal });
    };
    if (opening != null) lines.push({ kind: "opening", label: de?.opening != null ? "Opening cash" : "Opening (carried from last count)", by: null, inAmount: 0, outAmount: 0, balance: r2(opening) });
    if (de?.cash) push("sales", "Cash sales (Day End)", de.by, de.cash, 0);
    for (const m of d.moves.filter((x) => x.direction === "in")) push("in", m.label, m.by, m.amount, 0);
    for (const m of d.moves.filter((x) => x.direction === "out")) push("out", m.label, m.by, 0, m.amount);
    for (const t of d.tillOut) push("till_out", `Till cash out: ${t.reason}`, t.by, 0, t.amount);

    // Counted first; then the takings go to the Safe (136).
    const expected = opening == null ? null : bal;
    const counted = de?.closing ?? null;
    const toSafe = de?.bankIn ?? 0;
    if (toSafe) {
      bal = r2((counted ?? bal) - toSafe);
      lines.push({ kind: "bank", label: "Cash taken to Safe", by: de?.by ?? null, inAmount: 0, outAmount: r2(toSafe), balance: bal });
    }
    out.push({
      date: d.date,
      entered: !!de,
      opening,
      openingDiff: de?.opening != null && carry != null && Math.abs(de.opening - carry) >= 0.005 ? r2(de.opening - carry) : null,
      lines,
      expected,
      counted,
      variance: expected != null && counted != null ? r2(counted - expected) : null,
      carry: counted != null || expected != null ? r2((counted ?? expected ?? 0) - toSafe) : null,
    });
    carry = counted != null || expected != null ? r2((counted ?? expected ?? 0) - toSafe) : null;
  }
  return out;
}

/** The book for `from`..`to` (whole trading days), from the business's first Day End with an opening. */
export async function cashBook(businessId: number, from: string, to: string): Promise<{ start: string | null; days: BookDay[] }> {
  const db = bizDb(businessId);
  const startFrom = await bookStart(businessId);
  const { data: first } = await db.from("daily_accounts").select("trading_date")
    .not("opening_balance", "is", null).gte("trading_date", startFrom).order("trading_date").limit(1).maybeSingle();
  const start = (first?.trading_date as string | undefined) ?? null;
  if (!start || start > to) return { start, days: [] };
  const today = londonDateStr();
  const realFrom = from < start ? start : from;
  const realTo = to > today ? today : to;
  if (realFrom > realTo) return { start, days: [] };

  // Before the month: rebuild from the start so the carried balance is right.
  const calcFrom = start;
  const { start: tStart, end: tEnd } = tradingRangeUtc(calcFrom, realTo);
  const [rows, moves, periods] = await Promise.all([
    allRows<{ trading_date: string; opening_balance: number | null; cash: number | null; bank_in: number | null; closing_balance: number | null; submitted_by: number | null; updated_by: number | null }>((a, b) =>
      db.from("daily_accounts").select("trading_date, opening_balance, cash, bank_in, closing_balance, submitted_by, updated_by")
        .gte("trading_date", calcFrom).lte("trading_date", realTo).order("trading_date").range(a, b)),
    allRows<{ movement_date: string; direction: string; category: string; amount: number; reason: string; paid_to: string | null; staff_id: number | null }>((a, b) =>
      db.from("cash_movements").select("movement_date, direction, category, amount, reason, paid_to, staff_id").eq("method", "cash").eq("place", "till")
        .gte("movement_date", calcFrom).lte("movement_date", realTo).order("id").range(a, b)),
    allRows<{ id: number; opened_at: string }>((a, b) =>
      db.from("work_periods").select("id, opened_at").gte("opened_at", tStart).lte("opened_at", tEnd).order("id").range(a, b)),
  ]);
  const shiftDay = new Map(periods.map((p) => [p.id, londonDateStr(new Date(p.opened_at))]));
  const paidOuts = periods.length
    ? await allRows<{ work_period_id: number; amount: number; reason: string; staff_id: number | null }>((a, b) =>
        db.from("cash_paid_outs").select("work_period_id, amount, reason, staff_id").in("work_period_id", [...shiftDay.keys()]).order("id").range(a, b))
    : [];

  const ids = [...new Set([...rows.flatMap((r) => [r.submitted_by, r.updated_by]), ...moves.map((m) => m.staff_id), ...paidOuts.map((p) => p.staff_id)].filter((x): x is number => !!x))];
  const { data: staff } = ids.length ? await supabase.from("staff").select("id, name").in("id", ids) : { data: [] as { id: number; name: string }[] };
  const nameOf = (id: number | null) => (id ? (staff ?? []).find((s) => s.id === id)?.name ?? null : null);
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

  const byDate = new Map(rows.map((r) => [r.trading_date, r]));
  const inputs: DayInput[] = [];
  for (let d = calcFrom; d <= realTo; d = nextDay(d)) {
    const r = byDate.get(d);
    inputs.push({
      date: d,
      dayEnd: r ? { opening: num(r.opening_balance), cash: num(r.cash), bankIn: num(r.bank_in), closing: num(r.closing_balance), by: nameOf(r.submitted_by ?? r.updated_by) } : null,
      moves: moves.filter((m) => m.movement_date === d).map((m) => ({
        direction: m.direction as "in" | "out", amount: Number(m.amount), by: nameOf(m.staff_id),
        label: [cashCategoryLabel(m.category), m.reason && m.reason !== cashCategoryLabel(m.category) ? m.reason : null, m.paid_to].filter(Boolean).join(" · "),
      })),
      tillOut: paidOuts.filter((p) => shiftDay.get(p.work_period_id) === d).map((p) => ({ amount: Number(p.amount), reason: p.reason, by: nameOf(p.staff_id) })),
    });
  }
  const all = buildCashBook(inputs, null);
  return { start, days: all.filter((x) => x.date >= realFrom) };
}

function nextDay(d: string): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

// ── 🔒 Safe ────────────────────────────────────────────────────────────────

export type SafeLine = { date: string; kind: "takings" | "in" | "out" | "count"; label: string; by: string | null; inAmount: number; outAmount: number; balance: number; counted?: number; difference?: number };
export type SafeBook = { start: string | null; opening: number; lines: SafeLine[]; totalIn: number; totalOut: number; balance: number; lastCount: { date: string; counted: number; difference: number } | null };

/** Builds the Safe book (pure): every line in date order with a running balance from £0. */
export function buildSafeBook(
  entries: { date: string; kind: "takings" | "in" | "out"; label: string; by: string | null; amount: number }[],
  counts: { date: string; amount: number; by: string | null; note: string | null }[],
  from: string,
): Omit<SafeBook, "start"> {
  // Takings and money in first each day, then money out, then any count.
  const order = { takings: 0, in: 1, out: 2 } as const;
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);
  let bal = 0;
  let opening = 0;
  const lines: SafeLine[] = [];
  let totalIn = 0, totalOut = 0;
  let lastCount: SafeBook["lastCount"] = null;
  const countsSorted = [...counts].sort((a, b) => a.date.localeCompare(b.date));
  let ci = 0;
  const flushCounts = (upTo: string) => {
    while (ci < countsSorted.length && countsSorted[ci].date <= upTo) {
      const c = countsSorted[ci++];
      const difference = r2(c.amount - bal);
      if (c.date >= from) lines.push({ date: c.date, kind: "count", label: c.note ? `Safe counted · ${c.note}` : "Safe counted", by: c.by, inAmount: 0, outAmount: 0, balance: bal, counted: r2(c.amount), difference });
      lastCount = { date: c.date, counted: r2(c.amount), difference };
    }
  };
  for (const e of sorted) {
    flushCounts(prevDay(e.date));
    if (e.date < from) {
      bal = r2(bal + (e.kind === "out" ? -e.amount : e.amount));
      opening = bal;
      continue;
    }
    const inAmount = e.kind === "out" ? 0 : r2(e.amount);
    const outAmount = e.kind === "out" ? r2(e.amount) : 0;
    bal = r2(bal + inAmount - outAmount);
    totalIn = r2(totalIn + inAmount); totalOut = r2(totalOut + outAmount);
    lines.push({ date: e.date, kind: e.kind, label: e.label, by: e.by, inAmount, outAmount, balance: bal });
  }
  flushCounts("9999-12-31");
  return { opening, lines, totalIn, totalOut, balance: bal, lastCount };
}

/** The Safe for `from`..`to`: lines in the period, carried from the start. */
export async function safeBook(businessId: number, from: string, to: string): Promise<SafeBook> {
  const db = bizDb(businessId);
  const startFrom = await bookStart(businessId);
  const { data: first } = await db.from("daily_accounts").select("trading_date")
    .not("opening_balance", "is", null).gte("trading_date", startFrom).order("trading_date").limit(1).maybeSingle();
  const { data: firstMove } = await db.from("cash_movements").select("movement_date").eq("method", "cash").eq("place", "safe").gte("movement_date", startFrom).order("movement_date").limit(1).maybeSingle();
  const start = [first?.trading_date, firstMove?.movement_date].filter(Boolean).sort()[0] as string | undefined;
  const empty = { start: start ?? null, opening: 0, lines: [], totalIn: 0, totalOut: 0, balance: 0, lastCount: null };
  if (!start || start > to) return empty;
  const [rows, moves, counts, billPays] = await Promise.all([
    allRows<{ trading_date: string; bank_in: number | null; submitted_by: number | null; updated_by: number | null }>((a, b) =>
      db.from("daily_accounts").select("trading_date, bank_in, submitted_by, updated_by").gte("trading_date", start).lte("trading_date", to).order("trading_date").range(a, b)),
    allRows<{ movement_date: string; direction: string; category: string; amount: number; reason: string; paid_to: string | null; staff_id: number | null }>((a, b) =>
      db.from("cash_movements").select("movement_date, direction, category, amount, reason, paid_to, staff_id").eq("method", "cash").eq("place", "safe")
        .gte("movement_date", start).lte("movement_date", to).order("id").range(a, b)),
    allRows<{ count_date: string; amount: number; note: string | null; counted_by: number | null }>((a, b) =>
      db.from("safe_counts").select("count_date, amount, note, counted_by").gte("count_date", start).lte("count_date", to).order("count_date").order("id").range(a, b)),
    // Pending bills paid in cash go straight into the Safe (owner, 2026-10-15).
    // Not sales: SumUp's Z report already had the bill in its total.
    allRows<{ paid_date: string; amount: number; staff_id: number | null; bill_id: number }>((a, b) =>
      db.from("pending_bill_payments").select("paid_date, amount, staff_id, bill_id").eq("method", "cash")
        .gte("paid_date", start).lte("paid_date", to).order("id").range(a, b)),
  ]);
  const billIds = [...new Set(billPays.map((p) => p.bill_id))];
  const { data: bills } = billIds.length ? await db.from("pending_bills").select("id, customer").in("id", billIds) : { data: [] as { id: number; customer: string }[] };
  const customerOf = (id: number) => (bills ?? []).find((b) => b.id === id)?.customer ?? null;
  const ids = [...new Set([...rows.flatMap((r) => [r.submitted_by, r.updated_by]), ...moves.map((m) => m.staff_id), ...counts.map((c) => c.counted_by), ...billPays.map((p) => p.staff_id)].filter((x): x is number => !!x))];
  const { data: staff } = ids.length ? await supabase.from("staff").select("id, name").in("id", ids) : { data: [] as { id: number; name: string }[] };
  const nameOf = (id: number | null) => (id ? (staff ?? []).find((s) => s.id === id)?.name ?? null : null);
  const entries = [
    ...rows.filter((r) => Number(r.bank_in) > 0).map((r) => ({ date: r.trading_date, kind: "takings" as const, label: "Takings from till", by: nameOf(r.submitted_by ?? r.updated_by), amount: Number(r.bank_in) })),
    ...moves.map((m) => ({
      date: m.movement_date, kind: (m.direction === "in" ? "in" : "out") as "in" | "out", by: nameOf(m.staff_id), amount: Number(m.amount),
      label: [cashCategoryLabel(m.category), m.reason && m.reason !== cashCategoryLabel(m.category) ? m.reason : null, m.paid_to].filter(Boolean).join(" · "),
    })),
    ...billPays.map((p) => ({ date: p.paid_date, kind: "in" as const, by: nameOf(p.staff_id), amount: Number(p.amount), label: ["Pending bill paid", customerOf(p.bill_id)].filter(Boolean).join(" · ") })),
  ];
  const book = buildSafeBook(entries, counts.map((c) => ({ date: c.count_date, amount: Number(c.amount), by: nameOf(c.counted_by), note: c.note })), from);
  return { start, ...book };
}

function prevDay(d: string): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
}
