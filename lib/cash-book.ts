import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { allRows } from "@/lib/finance";
import { londonDateStr, tradingRangeUtc } from "@/lib/london-date";
import { cashCategoryLabel } from "@/lib/cash-categories";

// The Cash Book (Staff Hub → Daily accounts → Cash book, agreed 2026-10-12,
// like the INSOMNIA sheet): each business's own cash drawer, day by day, line
// by line, with a running balance. It starts from the first Day End's opening
// cash. Each day:
//   Opening (typed, or carried from the last count)
//   + cash sales (Day End "Cash")          + cash Money IN (staff link)
//   − cash Money OUT (staff link)          − till Cash Out
//   − Bank in (deposited / given to owner)
//   = Expected  → Counted → Variance (counted − expected)
// The next day carries on from what was counted (or expected, if no count).
// Only cash: card / bank transfer entries never touch the drawer.

export type BookLine = {
  kind: "opening" | "sales" | "in" | "out" | "till_out" | "bank";
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
    if (de?.bankIn) push("bank", "Bank in (deposited / given to owner)", de.by, 0, de.bankIn);

    const expected = opening == null ? null : bal;
    const counted = de?.closing ?? null;
    out.push({
      date: d.date,
      entered: !!de,
      opening,
      openingDiff: de?.opening != null && carry != null && Math.abs(de.opening - carry) >= 0.005 ? r2(de.opening - carry) : null,
      lines,
      expected,
      counted,
      variance: expected != null && counted != null ? r2(counted - expected) : null,
      carry: counted ?? expected,
    });
    carry = counted ?? expected;
  }
  return out;
}

/** The book for `from`..`to` (whole trading days), from the business's first Day End with an opening. */
export async function cashBook(businessId: number, from: string, to: string): Promise<{ start: string | null; days: BookDay[] }> {
  const db = bizDb(businessId);
  const { data: first } = await db.from("daily_accounts").select("trading_date")
    .not("opening_balance", "is", null).order("trading_date").limit(1).maybeSingle();
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
      db.from("cash_movements").select("movement_date, direction, category, amount, reason, paid_to, staff_id").eq("method", "cash")
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
