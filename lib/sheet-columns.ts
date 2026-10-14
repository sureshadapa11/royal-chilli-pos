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
//   • Catering pending — not shown: what's owed is on the Catering & events list
//   • everything else — the saved Day End figure

export type SheetKey = DailyFieldKey | "events_paid";
export const SHEET_COLUMNS: { key: SheetKey; label: string }[] = SHEET_FIELDS.filter((f) => f.key !== "catering_pending").flatMap((f) =>
  f.key === "catering_paid" ? [{ key: f.key as SheetKey, label: f.label }, { key: "events_paid" as SheetKey, label: "Events paid" }] : [{ key: f.key as SheetKey, label: f.label }]);

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

export function sheetCell(key: SheetKey, r: DailyRow | undefined, fig: DayFigures | undefined): number | null {
  if (key === "commission") return fig && (fig.out.commission || fig.out.card_fee) ? r2(fig.out.commission + fig.out.card_fee) : num(r?.commission);
  if (key === "catering_paid") return fig?.sales.catering ? fig.sales.catering : num(r?.catering_paid);
  if (key === "events_paid") return fig?.sales.events ? fig.sales.events : null;
  if (key === "pending") {
    const v = (num(r?.pending) ?? 0) + (fig?.pending_owed ?? 0);
    return v || num(r?.pending) != null ? r2(v) : null;
  }
  return num(r?.[key]);
}

export function sheetTotal(key: SheetKey, totals: Partial<Record<string, number | null>> | DailyValues, ft: FiguresTotal, rows: DailyRow[] = [], days: DayFigures[] = [], today = "9999-12-31"): number | null {
  if (key === "pending") {
    // The last day of the month that's been reached (today, for this month).
    const last = [...days].filter((d) => d.date <= today).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!last) return null;
    return sheetCell("pending", rows.find((r) => r.trading_date === last.date), last);
  }
  if (key === "commission") return r2(ft.out.commission + ft.out.card_fee);
  if (key === "catering_paid") return ft.sales.catering;
  if (key === "events_paid") return ft.sales.events;
  return (totals as Record<string, number | null | undefined>)[key] ?? null;
}
