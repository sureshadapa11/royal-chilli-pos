import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSessionFromRequest } from "@/lib/auth";
import { allBusinessesMonth } from "@/lib/all-businesses-accounts";
import { monthName, monthSheets, sheet, type Cell } from "@/lib/daily-accounts-workbook";

// GET ?month=YYYY-MM — Super admin: one Excel for every business, like the
// INSOMNIA workbook: a Summary sheet, then each business's Report, Money
// out, Cash book and Salary sheets (named with the business's code).
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session?.owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Pick a month" }, { status: 400 });

  const rows = await allBusinessesMonth(month);
  const head = ["Business", "Total sales", "Ex-VAT", "Commission & card fees", "Money out", "Net total", "Cash variance", "Cash in drawer now", "Day Ends", "Missing days", "Last Day End"];
  const sum = (f: (r: (typeof rows)[number]) => number | null) => Math.round(rows.reduce((s, r) => s + (f(r) ?? 0), 0) * 100) / 100;
  const summary: Cell[][] = [
    ["All businesses — Summary"],
    [`${monthName(month)} · each business has its own cash drawer · cash variance = counted − expected (minus = missing)`],
    [],
    head,
    ...rows.map((r) => [r.name + (r.active ? "" : " (not open)"), r.totalSales, r.exVat, r.commission, r.moneyOut, r.netTotal, r.cashVariance, r.cashNow, r.dayEnds, r.missing, r.lastDayEnd ?? ""]),
    ["TOTAL", sum((r) => r.totalSales), sum((r) => r.exVat), sum((r) => r.commission), sum((r) => r.moneyOut), sum((r) => r.netTotal), sum((r) => r.cashVariance), sum((r) => r.cashNow), sum((r) => r.dayEnds), sum((r) => r.missing), ""],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(summary, 3, 7, [26, 13, 12, 22, 12, 12, 14, 18, 10, 13, 14]), "Summary");

  const used = new Set(["Summary"]);
  for (const r of rows) {
    const { sheets } = await monthSheets(r.businessId, month, true);
    const prefix = r.code || r.name.split(/\s+/).filter((w) => w.toLowerCase() !== "the").map((w) => w[0]).join("").toUpperCase();
    for (const s of sheets) {
      let title = `${prefix} ${s.title}`.slice(0, 31);
      for (let i = 2; used.has(title); i++) title = `${prefix} ${s.title}`.slice(0, 28) + ` ${i}`;
      used.add(title);
      XLSX.utils.book_append_sheet(wb, s.ws, title);
    }
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Daily accounts All businesses ${month}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
