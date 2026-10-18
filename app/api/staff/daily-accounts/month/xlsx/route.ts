import { NextRequest, NextResponse } from "next/server";
import { accountsAccess } from "@/lib/accounts-access";
import * as XLSX from "xlsx";
import { getSessionFromRequest } from "@/lib/auth";
import { canSeeSalary } from "@/lib/salary-sheet";
import { monthSheets } from "@/lib/daily-accounts-workbook";

// GET ?month=YYYY-MM → this business's month as an Excel file: the Daily
// Accounts Report, Money out, Cash book and (Super admin / HR / Supervisor)
// Salary sheets — built in lib/daily-accounts-workbook.ts.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canExport) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Pick a month" }, { status: 400 });

  const { name, sheets } = await monthSheets(session.businessId, month, canSeeSalary(session));
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, s.ws, s.title);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const file = `Daily accounts ${name} ${month}.xlsx`.replace(/\s+/g, " ").trim();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
