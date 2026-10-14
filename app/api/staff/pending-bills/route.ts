import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { accountsAccess } from "@/lib/accounts-access";
import { bizDb } from "@/lib/business-db";
import { listBills, getBill } from "@/lib/pending-bills";
import { parseBill } from "@/lib/pending-bills-save";

// Daily accounts → Pending bills (134). GET ?month= → bills still owed + that
// month's bills. POST → a new unpaid bill. Tracking only.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).tabs.includes("bills")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Pick a month" }, { status: 400 });
  return NextResponse.json(await listBills(session.businessId, month), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canEnter) return NextResponse.json({ error: "You can view this but not add bills." }, { status: 403 });
  const bill = parseBill(await req.json().catch(() => null));
  if ("error" in bill) return NextResponse.json({ error: bill.error }, { status: 400 });
  const { data, error } = await bizDb(session.businessId).from("pending_bills").insert({ ...bill, created_by: session.id }).select("id").single();
  if (error || !data) return NextResponse.json({ error: "Couldn't save the bill. Please try again." }, { status: 500 });
  return NextResponse.json({ bill: await getBill(session.businessId, data.id) });
}
