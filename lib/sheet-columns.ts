import type { DayFigures, FiguresTotal } from "@/lib/daily-figures";
import type { DailyRow } from "@/lib/daily-accounts";
import { SHEET_FIELDS, type DailyFieldKey, type DailyValues } from "@/lib/daily-accounts-fields";

// The month sheet's typed-in columns (screen, print / PDF and Excel alike),
// with an Events paid column after Catering paid (133). Safe in the browser.
//   • Commission & card fees — worked out (platform commissions + card fee)
//   • Catering paid / Events paid — the day's sales parts: typed Day End
//     catering (older days) + Catering & events payments by cash or bank
//   • everything else — the saved Day End figure

export type SheetKey = DailyFieldKey | "events_paid";
export const SHEET_COLUMNS: { key: SheetKey; label: string }[] = SHEET_FIELDS.flatMap((f) =>
  f.key === "catering_paid" ? [{ key: f.key as SheetKey, label: f.label }, { key: "events_paid" as SheetKey, label: "Events paid" }] : [{ key: f.key as SheetKey, label: f.label }]);

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

export function sheetCell(key: SheetKey, r: DailyRow | undefined, fig: DayFigures | undefined): number | null {
  if (key === "commission") return fig && (fig.out.commission || fig.out.card_fee) ? r2(fig.out.commission + fig.out.card_fee) : num(r?.commission);
  if (key === "catering_paid") return fig?.sales.catering ? fig.sales.catering : num(r?.catering_paid);
  if (key === "events_paid") return fig?.sales.events ? fig.sales.events : null;
  return num(r?.[key]);
}

export function sheetTotal(key: SheetKey, totals: Partial<Record<string, number | null>> | DailyValues, ft: FiguresTotal): number | null {
  if (key === "commission") return r2(ft.out.commission + ft.out.card_fee);
  if (key === "catering_paid") return ft.sales.catering;
  if (key === "events_paid") return ft.sales.events;
  return (totals as Record<string, number | null | undefined>)[key] ?? null;
}
