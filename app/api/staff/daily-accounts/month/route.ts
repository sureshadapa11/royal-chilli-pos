import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageDailyAccounts } from "@/lib/permissions";
import { columnTotals } from "@/lib/daily-accounts";
import { accountsByDay, totalFigures } from "@/lib/daily-figures";

// GET ?month=YYYY-MM → that month's saved day-end sheets (draft and submitted)
// and the month total row, like the paper Daily Accounts Report, plus each
// day's Total sales / Ex-VAT / Money out / Net total / Variance (lib/daily-figures.ts).
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

  try {
    const { days, rows } = await accountsByDay(session.businessId, from, to);
    return NextResponse.json({ month, from, to, rows, totals: columnTotals(rows), days, figuresTotal: totalFigures(days) });
  } catch {
    return NextResponse.json({ error: "Couldn't load the month" }, { status: 500 });
  }
}
