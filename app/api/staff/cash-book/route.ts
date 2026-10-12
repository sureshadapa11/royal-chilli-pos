import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { cashBook } from "@/lib/cash-book";

// GET ?month=YYYY-MM — Staff Hub → Daily accounts → Cash book: this business's
// cash drawer day by day with a running balance (lib/cash-book.ts).
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "daily_accounts", "GET")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Pick a month" }, { status: 400 });
  const [y, m] = month.split("-").map(Number);
  const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  return NextResponse.json(await cashBook(session.businessId, `${month}-01`, to));
}
