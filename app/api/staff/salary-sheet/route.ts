import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { canSeeSalary, salarySheet } from "@/lib/salary-sheet";

// GET ?month=YYYY-MM — Staff Hub → Daily accounts → Salary (Super admin, HR,
// Supervisor): each person's wages, paid, advances and balance to pay.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canSeeSalary(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Pick a month" }, { status: 400 });
  const [y, m] = month.split("-").map(Number);
  const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  // A group owner (All businesses view) can pick any business with ?business=.
  const pick = Number(req.nextUrl.searchParams.get("business"));
  const businessId = session.owner && Number.isInteger(pick) && pick > 0 && (await getBusiness(pick).catch(() => null)) ? pick : session.businessId;
  return NextResponse.json({ rows: await salarySheet(businessId, `${month}-01`, to) });
}
