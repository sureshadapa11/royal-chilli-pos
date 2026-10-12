import * as XLSX from "xlsx";
import { getBusiness } from "@/lib/business";
import { columnTotals } from "@/lib/daily-accounts";
import { SHEET_FIELDS } from "@/lib/daily-accounts-fields";
import { accountsByDay, MONEY_OUT_PARTS, totalFigures } from "@/lib/daily-figures";
import { cashBook } from "@/lib/cash-book";
import { salarySheet } from "@/lib/salary-sheet";

// The month's Daily Accounts workbook sheets (one business), shared by the
// month Excel (app/api/staff/daily-accounts/month/xlsx) and the Super admin
// All businesses Excel. The Daily Accounts Report as a real Excel sheet:
// every day of the month, each column, MONTH TOTAL. It starts with the worked-
// out Total sales, Ex-VAT, Money out and Net total and ends with Variance
// (lib/daily-figures.ts); a second sheet splits each day's Money out into its
// parts. Dates are text (so Excel never shows ##### in a narrow column),
// amounts are numbers to 2 decimals, and every column is wide enough to read.
export const dayName = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
export const monthName = (m: string) => new Date(m + "-01T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

const LEAD = [
  { key: "total_sales", label: "Total sales" },
  { key: "ex_vat", label: "Ex-VAT" },
  { key: "money_out", label: "Money out" },
  { key: "net_total", label: "Net total" },
] as const;

const FORMULA = "Total sales = Z report (tips not included) + Just Eat + Deliveroo + Uber Eats + Hiest + catering paid · Ex-VAT = Total sales ÷ 1.2 · "
  + "Money out = stock received + expenses (VAT claimed back taken off) + card fee + till paid out + staff wages + commission · Net total = Ex-VAT − Money out · "
  + "Commission & card fees = platform commissions + card fee · Variance = cash counted − cash expected (opening + cash sales + cash in − cash out − bank in) · * no Z report on the sheet yet, the till's figure is used";

export type Cell = string | number | null;

/** A sheet with a two-line title, money formatting from column 1 to `lastMoney`, and widths. */
export function sheet(aoa: Cell[][], headerRow: number, lastMoney: number, widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let r = headerRow + 1; r < aoa.length; r++) {
    for (let c = 1; c <= lastMoney; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
    }
  }
  ws["!cols"] = widths.map((wch) => ({ wch }));
  const width = aoa[headerRow].length - 1;
  ws["!merges"] = [0, 1].map((r) => ({ s: { r, c: 0 }, e: { r, c: width } }));
  return ws;
}

export type NamedSheet = { title: string; ws: XLSX.WorkSheet };

/** The month (YYYY-MM) as its first and last day. */
export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const end = new Date(from + "T00:00:00Z");
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return { from, to: end.toISOString().slice(0, 10) };
}

/** One business's month: Report, Money out, Cash book and (if allowed) Salary sheets. */
export async function monthSheets(businessId: number, month: string, includeSalary: boolean): Promise<{ name: string; sheets: NamedSheet[] }> {
  const { from, to } = monthRange(month);

  const [{ days, rows }, business] = await Promise.all([
    accountsByDay(businessId, from, to),
    getBusiness(businessId).catch(() => null),
  ]);
  const byDate = new Map(rows.map((r) => [r.trading_date, r]));
  const totals = columnTotals(rows);
  const ft = totalFigures(days);
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const name = business?.name ?? "Daily accounts";

  // Sheet 1: the Daily Accounts Report.
  const head = ["Date", ...LEAD.map((c) => c.label), ...SHEET_FIELDS.map((f) => f.label), "Variance", "Notes", "Status"];
  const report: Cell[][] = [
    [`${name} — Daily Accounts Report`],
    [`Reporting month: ${monthName(month)} · amounts in £ · the total adds up each column on its own`],
    [],
    head,
    ...days.map((f) => {
      const r = byDate.get(f.date);
      return [
        dayName(f.date) + (f.till_fallback ? " *" : ""),
        ...LEAD.map((c) => f[c.key]),
        ...SHEET_FIELDS.map((x) => (x.key === "commission" ? (f.out.commission || f.out.card_fee ? Math.round((f.out.commission + f.out.card_fee) * 100) / 100 : num(r?.commission)) : num(r?.[x.key]))),
        f.variance,
        r?.notes ?? "",
        r ? (r.status === "submitted" ? "Submitted" : "Draft") : "",
      ];
    }),
    ["MONTH TOTAL", ...LEAD.map((c) => ft[c.key]), ...SHEET_FIELDS.map((x) => (x.key === "commission" ? Math.round((ft.out.commission + ft.out.card_fee) * 100) / 100 : totals[x.key])), ft.variance, "", ""],
    [],
    [FORMULA],
  ];
  const ws1 = sheet(report, 3, LEAD.length + SHEET_FIELDS.length + 1,
    [16, ...LEAD.map((c) => Math.max(12, c.label.length + 2)), ...SHEET_FIELDS.map((f) => Math.max(11, f.label.length + 2)), 11, 40, 11]);

  // Sheet 2: what's in each day's Money out.
  const outHead = ["Date", ...MONEY_OUT_PARTS.map((p) => p.label), "Money out"];
  const breakdown: Cell[][] = [
    [`${name} — Money out by day`],
    [`${monthName(month)} · stock = deliveries received · expenses = VAT claimed back taken off · card fee = card × card fee rate · till paid out = cash taken out of the till · staff wages = hours × pay rate`],
    [],
    outHead,
    ...days.map((f) => [dayName(f.date), ...MONEY_OUT_PARTS.map((p) => f.out[p.key]), f.money_out]),
    ["MONTH TOTAL", ...MONEY_OUT_PARTS.map((p) => ft.out[p.key]), ft.money_out],
  ];
  const ws2 = sheet(breakdown, 3, outHead.length - 1, [16, ...outHead.slice(1).map((h) => Math.max(13, h.length + 2))]);

  // Sheet 3: the cash book (lib/cash-book.ts), line by line with a running balance.
  const book = await cashBook(businessId, from, to);
  const bookRows: Cell[][] = [
    [`${name} — Cash book`],
    [`${monthName(month)} · cash only · each day: opening + cash sales + cash in − cash out − bank in = expected, then counted and variance (counted − expected)${book.start ? ` · book starts ${dayName(book.start)}` : " · no Day End with an opening yet"}`],
    [],
    ["Date", "In", "Out", "Balance", "Particulars", "Person"],
  ];
  for (const d of book.days) {
    d.lines.forEach((l, i) => bookRows.push([i === 0 ? dayName(d.date) : "", l.inAmount || null, l.outAmount || null, l.balance,
      l.label + (l.kind === "opening" && d.openingDiff != null ? ` (differs from last count by ${d.openingDiff.toFixed(2)})` : ""), l.by ?? ""]));
    if (!d.entered) bookRows.push([d.lines.length ? "" : dayName(d.date), null, null, null, "No Day End for this day", ""]);
    if (d.expected != null) bookRows.push(["", null, null, d.carry, `Expected ${d.expected.toFixed(2)} · Counted ${d.counted == null ? "—" : d.counted.toFixed(2)} · Variance ${d.variance == null ? "not counted" : d.variance.toFixed(2)}`, ""]);
  }
  const ws3 = sheet(bookRows, 3, 3, [16, 12, 12, 13, 60, 18]);

  const sheets: NamedSheet[] = [
    { title: monthName(month).slice(0, 31), ws: ws1 },
    { title: "Money out", ws: ws2 },
    { title: "Cash book", ws: ws3 },
  ];

  // Sheet 4 (Super admin, HR, Supervisor): salary.
  if (includeSalary) {
    const sal = await salarySheet(businessId, from, to);
    const salHead = ["Person", "Hours", "Pay rate", "Wages", "Paid (staff link)", "Advance given", "Repaid", "Taken off pay", "Advance owed", "Balance to pay"];
    const tot = (f: (r: (typeof sal)[number]) => number) => Math.round(sal.reduce((s, r) => s + f(r), 0) * 100) / 100;
    const salRows: Cell[][] = [
      [`${name} — Salary`],
      [`${monthName(month)} · wages = hours × pay rate · balance to pay = wages − paid through the staff link − advance still owed`],
      [],
      salHead,
      ...sal.map((r) => [r.name, r.hours, r.payRate, r.wages, r.paid, r.advanceGiven, r.advanceRepaid, r.advanceDeducted, r.advanceOwed, r.balance]),
      ["TOTAL", tot((r) => r.hours), null, tot((r) => r.wages), tot((r) => r.paid), tot((r) => r.advanceGiven), tot((r) => r.advanceRepaid), tot((r) => r.advanceDeducted), tot((r) => r.advanceOwed), tot((r) => r.balance)],
    ];
    sheets.push({ title: "Salary", ws: sheet(salRows, 3, salHead.length - 1, [22, ...salHead.slice(1).map((h) => Math.max(11, h.length + 2))]) });
  }
  return { name, sheets };
}
