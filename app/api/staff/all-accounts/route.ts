import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { allBusinessesMonth } from "@/lib/all-businesses-accounts";

// GET ?month=YYYY-MM — Super admin's All businesses Summary (Daily accounts):
// every business's month side by side (lib/all-businesses-accounts.ts).
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session?.owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Pick a month" }, { status: 400 });
  return NextResponse.json({ rows: await allBusinessesMonth(month) });
}
