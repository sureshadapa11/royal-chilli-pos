import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageDailyAccounts } from "@/lib/permissions";
import { getBusiness } from "@/lib/business";
import { columnTotals } from "@/lib/daily-accounts";
import { SHEET_FIELDS } from "@/lib/daily-accounts-fields";
import { accountsByDay, MONEY_OUT_PARTS, totalFigures } from "@/lib/daily-figures";

// GET ?month=YYYY-MM → the month's Daily Accounts Report as a real Excel file:
// every day of the month, each column, MONTH TOTAL. It starts with the worked-
// out Total sales, Ex-VAT, Money out and Net total and ends with Variance
// (lib/daily-figures.ts); a second sheet splits each day's Money out into its
// parts. Dates are text (so Excel never shows ##### in a narrow column),
// amounts are numbers to 2 decimals, and every column is wide enough to read.
const dayName = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const monthName = (m: string) => new Date(m + "-01T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

const LEAD = [
  { key: "total_sales", label: "Total sales" },
  { key: "ex_vat", label: "Ex-VAT" },
  { key: "money_out", label: "Money out" },
  { key: "net_total", label: "Net total" },
] as const;

const FORMULA = "Total sales = Z report (tips not included) + Just Eat + Deliveroo + Uber Eats + Hiest + catering paid · Ex-VAT = Total sales ÷ 1.2 · "
  + "Money out = stock received + expenses (VAT claimed back taken off) + card fee + till paid out + staff wages + commission · Net total = Ex-VAT − Money out · "
  + "Commission & card fees = platform commissions + card fee · Variance = closing balance − opening balance · * no Z report on the sheet yet, the till's figure is used";

type Cell = string | number | null;

/** A sheet with a two-line title, money formatting from column 1 to `lastMoney`, and widths. */
function sheet(aoa: Cell[][], headerRow: number, lastMoney: number, widths: number[]): XLSX.WorkSheet {
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

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageDailyAccounts(session.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Pick a month" }, { status: 400 });

  const from = `${month}-01`;
  const end = new Date(from + "T00:00:00Z");
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  const to = end.toISOString().slice(0, 10);

  const [{ days, rows }, business] = await Promise.all([
    accountsByDay(session.businessId, from, to),
    getBusiness(session.businessId).catch(() => null),
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

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, monthName(month).slice(0, 31));
  XLSX.utils.book_append_sheet(wb, ws2, "Money out");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const file = `Daily accounts ${business?.name ?? ""} ${month}.xlsx`.replace(/\s+/g, " ").trim();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
