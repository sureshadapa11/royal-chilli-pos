import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageFinance } from "@/lib/permissions";
import { getBusiness } from "@/lib/business";
import { columnTotals, savedDays } from "@/lib/daily-accounts";
import { DAILY_FIELDS } from "@/lib/daily-accounts-fields";

// GET ?month=YYYY-MM → the month's Daily Accounts Report as a real Excel file:
// every day of the month, each column, MONTH TOTAL. Dates are text (so Excel
// never shows ##### in a narrow column), amounts are numbers to 2 decimals,
// and every column is wide enough to read.
const dayName = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const monthName = (m: string) => new Date(m + "-01T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageFinance(session.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Pick a month" }, { status: 400 });

  const from = `${month}-01`;
  const end = new Date(from + "T00:00:00Z");
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  const to = end.toISOString().slice(0, 10);

  const [rows, business] = await Promise.all([savedDays(session.businessId, from, to), getBusiness(session.businessId).catch(() => null)]);
  const byDate = new Map(rows.map((r) => [r.trading_date, r]));
  const totals = columnTotals(rows);
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

  const days: string[] = [];
  for (let d = from; d <= to; ) {
    days.push(d);
    const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); d = x.toISOString().slice(0, 10);
  }

  const title = `${business?.name ?? "Daily accounts"} — Daily Accounts Report`;
  const head = ["Date", ...DAILY_FIELDS.map((f) => f.label), "Notes", "Status"];
  const aoa: (string | number | null)[][] = [
    [title],
    [`Reporting month: ${monthName(month)} · amounts in £ · the total adds up each column on its own`],
    [],
    head,
    ...days.map((d) => {
      const r = byDate.get(d);
      return [dayName(d), ...DAILY_FIELDS.map((f) => num(r?.[f.key])), r?.notes ?? "", r ? (r.status === "submitted" ? "Submitted" : "Draft") : ""];
    }),
    ["MONTH TOTAL", ...DAILY_FIELDS.map((f) => totals[f.key]), "", ""],
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Amounts as money with 2 decimals.
  const firstRow = 4; // header is row 4 (index 3); data starts at index 4
  for (let r = firstRow; r < aoa.length; r++) {
    for (let c = 1; c <= DAILY_FIELDS.length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
    }
  }
  ws["!cols"] = [{ wch: 14 }, ...DAILY_FIELDS.map((f) => ({ wch: Math.max(11, f.label.length + 2) })), { wch: 40 }, { wch: 11 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: head.length - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: head.length - 1 } }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, monthName(month).slice(0, 31));
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
