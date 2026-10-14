import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { accountsByDay } from "@/lib/daily-figures";
import { savedDays } from "@/lib/daily-accounts";
import { cashBook, safeBook } from "@/lib/cash-book";
import { addDays } from "@/lib/admin-dashboard";
import { extractVat, getVatRate } from "@/lib/finance";
import { getBusinessNumber } from "@/lib/business-settings";
import { cashCategoryLabel } from "@/lib/cash-categories";
import { CARD_PLATFORMS } from "@/lib/dashboard-cards-meta";
import { listJobs } from "@/lib/catering-jobs";
import { listBills } from "@/lib/pending-bills";

// The dashboard's newer cards (agreed 2026-10-12, mock-up "New Dashboard
// Cards"), all from what's entered by hand — Day End / Daily accounts, the
// Money In / Out link, and clock-ins — so they work without the till.
// Money cards (cash health, where the cash went, VAT, money owed) are only
// sent to Super admin / Supervisor; Managers get the sales and staff cards.

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v));

export type ExtraCards = {
  target: { month: string; sales: number; target: number | null; daysGone: number; daysInMonth: number };
  streak: { days: { date: string; entered: boolean }[]; current: number; missing: string[] };
  perHour: { sales: number; seconds: number; value: number | null; prevValue: number | null; series: { date: string; value: number | null }[] };
  calendar: { month: string; days: { date: string; sales: number | null }[]; best: { date: string; sales: number } | null };
  weekdays: { day: number; label: string; avg: number | null; count: number }[];
  paid: { card: number; cash: number; delivery: number };
  commission: { key: string; label: string; sales: number; commission: number; pct: number | null }[];
  staffHours: { name: string; seconds: number }[];
  stillIn: number;
  money: null | {
    cashNow: number | null; safeNow: number | null; variance: number | null; daysOff: number; varianceByDay: { date: string; variance: number }[];
    cashOut: { label: string; amount: number }[];
    vat: { sales: number; claimed: number; toPay: number; quarterToPay: number };
    owed: { pending: number; catering: number; asOf: string | null; jobs: { customer: string; kind: string; date: string; owed: number }[] };
  };
};

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const isoDow = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export async function getExtraCards(businessId: number, range: { from: string; to: string }, prev: { from: string; to: string }, today: string, withMoney: boolean): Promise<ExtraCards> {
  const db = bizDb(businessId);
  const month = range.from.slice(0, 7);
  const monthFrom = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthTo = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const lastDay = range.to < today ? range.to : today;
  const weeksFrom = addDays(lastDay, -55);
  const earliest = [range.from, prev.from, monthFrom, weeksFrom, addDays(today, -13)].sort()[0];
  const latest = [range.to, monthTo, today].sort().reverse()[0];

  const [{ days }, rows, attendance, target] = await Promise.all([
    accountsByDay(businessId, earliest, latest),
    savedDays(businessId, earliest, latest),
    db.from("attendance").select("staff_id, work_date, clock_in, clock_out, net_work_seconds").gte("work_date", earliest).lte("work_date", latest),
    getBusinessNumber(businessId, "monthly_sales_target", 0),
  ]);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const rowBy = new Map(rows.map((r) => [r.trading_date, r]));
  const entered = (d: string) => rowBy.get(d)?.status === "submitted";
  const sales = (d: string) => byDate.get(d)?.total_sales ?? 0;
  const inRange = (d: string, r: { from: string; to: string }) => d >= r.from && d <= r.to && d <= today;
  const rangeDays = daysBetween(range.from, range.to).filter((d) => d <= today);
  const prevDays = daysBetween(prev.from, prev.to).filter((d) => d <= today);

  // 🎯 Target: the month's sales so far against the business's target.
  const monthDays = daysBetween(monthFrom, monthTo);
  const monthSales = r2(monthDays.filter((d) => d <= today).reduce((s, d) => s + sales(d), 0));
  const daysGone = monthDays.filter((d) => d < today).length;

  // ✅ Streak: the last 14 days (to yesterday, or today once it's entered).
  const end = entered(today) ? today : addDays(today, -1);
  const streakDays = daysBetween(addDays(end, -13), end).map((d) => ({ date: d, entered: entered(d) }));
  let current = 0;
  for (let i = streakDays.length - 1; i >= 0 && streakDays[i].entered; i--) current++;

  // ⏱️ Sales per staff hour.
  const att = attendance.data ?? [];
  const secondsOn = (pred: (d: string) => boolean) => att.filter((a) => a.clock_out && pred(a.work_date)).reduce((s, a) => s + num(a.net_work_seconds), 0);
  // Only days with sales figures count, or hours on un-entered days would drag it down.
  const perHourOf = (all: string[]) => {
    const list = all.filter((d) => sales(d) > 0);
    const set = new Set(list);
    const s = list.reduce((t, d) => t + sales(d), 0);
    const sec = secondsOn((d) => set.has(d));
    return { s: r2(s), sec, v: sec > 0 && s > 0 ? r2(s / (sec / 3600)) : null };
  };
  const cur = perHourOf(rangeDays);
  const before = perHourOf(prevDays);

  // 📅 Calendar for the month; 📊 weekdays over the last 8 weeks (entered days only).
  const calDays = monthDays.map((d) => ({ date: d, sales: d <= today && (entered(d) || sales(d) > 0) ? r2(sales(d)) : null }));
  const best = calDays.filter((d) => d.sales != null).sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0))[0];
  const weekDaysList = daysBetween(weeksFrom, lastDay).filter(entered);
  const weekdays = WEEKDAY.map((label, i) => {
    const list = weekDaysList.filter((d) => isoDow(d) === i);
    return { day: i, label, avg: list.length ? r2(list.reduce((s, d) => s + sales(d), 0) / list.length) : null, count: list.length };
  });

  // 💳 How customers paid; 🛵 commission % per platform (the period).
  let card = 0, cash = 0, delivery = 0;
  const plat = new Map<string, { sales: number; commission: number }>();
  for (const d of rangeDays) {
    const r = rowBy.get(d);
    if (!r) continue;
    card += num(r.card); cash += num(r.cash);
    for (const p of CARD_PLATFORMS) {
      const sl = num(r[p.key as keyof typeof r]); const cm = num(r[`${p.key}_commission` as keyof typeof r]);
      delivery += sl;
      const x = plat.get(p.key) ?? { sales: 0, commission: 0 };
      plat.set(p.key, { sales: x.sales + sl, commission: x.commission + cm });
    }
  }
  const commission = CARD_PLATFORMS.map((p) => {
    const x = plat.get(p.key) ?? { sales: 0, commission: 0 };
    return { key: p.key, label: p.label, sales: r2(x.sales), commission: r2(x.commission), pct: x.sales > 0 && x.commission > 0 ? Math.round((x.commission / x.sales) * 1000) / 10 : null };
  });

  // 👥 Staff hours (hours only) in the period.
  const perStaff = new Map<number, number>();
  for (const a of att) if (a.clock_out && inRange(a.work_date, range)) perStaff.set(a.staff_id, (perStaff.get(a.staff_id) ?? 0) + num(a.net_work_seconds));
  const stillIn = att.filter((a) => !a.clock_out && a.clock_in && inRange(a.work_date, range)).length;
  const ids = [...perStaff.keys()];
  const { data: staff } = ids.length ? await supabase.from("staff").select("id, name").in("id", ids) : { data: [] as { id: number; name: string }[] };
  const staffHours = ids.map((id) => ({ name: (staff ?? []).find((s) => s.id === id)?.name ?? "—", seconds: perStaff.get(id)! }))
    .sort((a, b) => b.seconds - a.seconds);

  let money: ExtraCards["money"] = null;
  if (withMoney) {
    // 💰 Cash health (cash book over the period); 🍩 cash out by category.
    const [book, { data: outs }, vatRate, { data: vatExp }] = await Promise.all([
      cashBook(businessId, range.from, range.to),
      db.from("cash_movements").select("category, amount").eq("direction", "out").eq("method", "cash").gte("movement_date", range.from).lte("movement_date", range.to),
      getVatRate(businessId),
      db.from("expenses").select("amount, expense_date").eq("vat_applicable", 1).gte("expense_date", quarterStart(range.from) < range.from ? quarterStart(range.from) : range.from).lte("expense_date", range.to),
    ]);
    const withVar = book.days.filter((d) => d.variance != null);
    const lastCarry = [...book.days].reverse().find((d) => d.carry != null);
    const byCat = new Map<string, number>();
    for (const o of outs ?? []) byCat.set(o.category, (byCat.get(o.category) ?? 0) + num(o.amount));

    // 🏛️ VAT: the period, and the calendar quarter to date.
    const vatOn = (list: string[]) => r2(list.reduce((s, d) => s + (byDate.get(d) ? byDate.get(d)!.total_sales - byDate.get(d)!.ex_vat : 0), 0));
    const claimedIn = (from: string, to: string) => r2((vatExp ?? []).filter((e) => e.expense_date >= from && e.expense_date <= to).reduce((s, e) => s + extractVat(num(e.amount), vatRate), 0));
    const salesVat = vatOn(rangeDays);
    const claimed = claimedIn(range.from, range.to);
    const qFrom = quarterStart(range.from);
    const qDaysAll = daysBetween(qFrom, lastDay);
    // Quarter days before `earliest` aren't loaded above; fetch them if needed.
    let quarterSalesVat = vatOn(qDaysAll.filter((d) => byDate.has(d)));
    if (qFrom < earliest) {
      const { days: older } = await accountsByDay(businessId, qFrom, addDays(earliest, -1));
      quarterSalesVat = r2(quarterSalesVat + older.reduce((s, d) => s + d.total_sales - d.ex_vat, 0));
    }

    // ⏳ Money owed: the latest entered day's pending bills and catering still owed.
    // Catering & events still owed, job by job (133), plus any older typed catering pending.
    const [openJobs, openBills] = await Promise.all([
      listJobs(businessId, today.slice(0, 7)).then((l) => l.owed),
      listBills(businessId, today.slice(0, 7)).then((l) => l.owed),
    ]);
    const latestRow = [...rows].filter((r) => r.trading_date <= today).sort((a, b) => b.trading_date.localeCompare(a.trading_date))[0];
    money = {
      cashNow: lastCarry?.carry ?? null,
      safeNow: (await safeBook(businessId, range.from, range.to)).balance,
      variance: withVar.length ? r2(withVar.reduce((s, d) => s + (d.variance ?? 0), 0)) : null,
      daysOff: withVar.filter((d) => Math.abs(d.variance ?? 0) >= 0.005).length,
      varianceByDay: withVar.map((d) => ({ date: d.date, variance: d.variance as number })),
      cashOut: [...byCat.entries()].map(([k, v]) => ({ label: cashCategoryLabel(k), amount: r2(v) })).sort((a, b) => b.amount - a.amount),
      vat: { sales: salesVat, claimed, toPay: r2(salesVat - claimed), quarterToPay: r2(quarterSalesVat - claimedIn(qFrom, lastDay)) },
      owed: {
        // Pending bills list (134) + any figure typed on an older Day End.
        pending: r2(num(latestRow?.pending) + openBills.reduce((s, b) => s + b.owed, 0)),
        catering: r2(num(latestRow?.catering_pending) + openJobs.reduce((s, j) => s + j.owed, 0)),
        asOf: latestRow?.trading_date ?? null,
        jobs: [
          ...openJobs.map((j) => ({ customer: j.customer, kind: j.kind as string, date: j.date, owed: j.owed })),
          ...openBills.map((b) => ({ customer: b.customer, kind: "bill", date: b.date, owed: b.owed })),
        ].sort((a, b) => b.owed - a.owed),
      },
    };
  }

  return {
    target: { month, sales: monthSales, target: target > 0 ? target : null, daysGone, daysInMonth },
    streak: { days: streakDays, current, missing: streakDays.filter((d) => !d.entered).map((d) => d.date) },
    perHour: {
      sales: cur.s, seconds: cur.sec, value: cur.v, prevValue: before.v,
      series: rangeDays.map((d) => { const x = perHourOf([d]); return { date: d, value: x.v }; }),
    },
    calendar: { month, days: calDays, best: best && best.sales != null ? { date: best.date, sales: best.sales } : null },
    weekdays,
    paid: { card: r2(card), cash: r2(cash), delivery: r2(delivery) },
    commission,
    staffHours,
    stillIn,
    money,
  };
}

/** First day of the calendar quarter (Jan / Apr / Jul / Oct). */
export function quarterStart(d: string): string {
  const [y, m] = d.split("-").map(Number);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qm).padStart(2, "0")}-01`;
}
