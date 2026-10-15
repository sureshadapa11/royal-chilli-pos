import type { DayFigures, FiguresTotal } from "@/lib/daily-figures";
import type { DailyRow } from "@/lib/daily-accounts";
import { SHEET_FIELDS, type DailyFieldKey, type DailyValues } from "@/lib/daily-accounts-fields";

// The month sheet's typed-in columns (screen, print / PDF and Excel alike),
// with an Events paid column after Catering paid (133). Safe in the browser.
//   • Commission & card fees — worked out (platform commissions + card fee)
//   • Catering paid / Events paid — the day's sales parts: typed Day End
//     catering (older days) + Catering & events payments by cash or bank
//   • Pending — bills still owed at the end of that day: the Pending bills
//     list (134) plus any figure typed on older days; the month's figure is
//     the latest day's, not a sum
//   • Pending bills / Catering unpaid / Events unpaid (agreed 2026-10-15) —
//     what's still owed at the end of that day: the Pending bills list, and
//     catering / event jobs from their event date (old typed Catering pending
//     counts as catering unpaid); part payments bring them down
//   • Pending — everything owed: those three + any old typed Pending figure
//   • For all four the month's figure is the latest day's, not a sum
//   • everything else — the saved Day End figure

export type SheetKey = DailyFieldKey | "events_paid" | "bills_owed" | "catering_unpaid" | "events_unpaid";
export const SHEET_COLUMNS: { key: SheetKey; label: string }[] = [
  { key: "bills_owed", label: "Pending bills" },
  ...SHEET_FIELDS.filter((f) => f.key !== "catering_pending").flatMap((f): { key: SheetKey; label: string }[] =>
    f.key === "catering_paid" ? [
      { key: "catering_paid", label: f.label }, { key: "catering_unpaid", label: "Catering unpaid" },
      { key: "events_paid", label: "Events paid" }, { key: "events_unpaid", label: "Events unpaid" },
    ] : [{ key: f.key as SheetKey, label: f.label }]),
];

/** Owed columns: a balance at the end of each day, so the month shows the latest day's. */
const OWED_KEYS: SheetKey[] = ["pending", "bills_owed", "catering_unpaid", "events_unpaid"];

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

export function sheetCell(key: SheetKey, r: DailyRow | undefined, fig: DayFigures | undefined): number | null {
  if (key === "commission") return fig && (fig.out.commission || fig.out.card_fee) ? r2(fig.out.commission + fig.out.card_fee) : num(r?.commission);
  if (key === "catering_paid") return fig?.sales.catering ? fig.sales.catering : num(r?.catering_paid);
  if (key === "events_paid") return fig?.sales.events ? fig.sales.events : null;
  const owedOrBlank = (v: number) => (v ? r2(v) : null);
  if (key === "bills_owed") return owedOrBlank(fig?.pending_owed ?? 0);
  if (key === "catering_unpaid") return owedOrBlank((fig?.catering_owed ?? 0) + (num(r?.catering_pending) ?? 0));
  if (key === "events_unpaid") return owedOrBlank(fig?.events_owed ?? 0);
  if (key === "pending") {
    const v = (num(r?.pending) ?? 0) + (fig?.pending_owed ?? 0) + (fig?.catering_owed ?? 0) + (num(r?.catering_pending) ?? 0) + (fig?.events_owed ?? 0);
    return v || num(r?.pending) != null ? r2(v) : null;
  }
  return num(r?.[key]);
}

export function sheetTotal(key: SheetKey, totals: Partial<Record<string, number | null>> | DailyValues, ft: FiguresTotal, rows: DailyRow[] = [], days: DayFigures[] = [], today = "9999-12-31"): number | null {
  if (OWED_KEYS.includes(key)) {
    // The last day of the month that's been reached (today, for this month).
    const last = [...days].filter((d) => d.date <= today).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!last) return null;
    return sheetCell(key, rows.find((r) => r.trading_date === last.date), last);
  }
  if (key === "commission") return r2(ft.out.commission + ft.out.card_fee);
  if (key === "catering_paid") return ft.sales.catering;
  if (key === "events_paid") return ft.sales.events;
  return (totals as Record<string, number | null | undefined>)[key] ?? null;
}
