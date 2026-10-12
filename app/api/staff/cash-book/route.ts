import { NextRequest, NextResponse } from "next/server";
import { accountsAccess } from "@/lib/accounts-access";
import { getSessionFromRequest } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { cashBook } from "@/lib/cash-book";

// GET ?month=YYYY-MM — Staff Hub → Daily accounts → Cash book: this business's
// cash drawer day by day with a running balance (lib/cash-book.ts).
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).seeFigures) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Pick a month" }, { status: 400 });
  const [y, m] = month.split("-").map(Number);
  const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  // A group owner (All businesses view) can pick any business with ?business=.
  const pick = Number(req.nextUrl.searchParams.get("business"));
  const businessId = session.owner && Number.isInteger(pick) && pick > 0 && (await getBusiness(pick).catch(() => null)) ? pick : session.businessId;
  return NextResponse.json(await cashBook(businessId, `${month}-01`, to));
}
