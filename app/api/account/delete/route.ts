import { NextRequest, NextResponse } from "next/server";
import { getCustomerSessionFromRequest, getCustomerSessionCookieOptions } from "@/lib/customer-auth";
import { deleteCustomerAccount } from "@/lib/customer-delete";

// "Delete my account" — the customer types DELETE to confirm (AccountView).
export async function POST(req: NextRequest) {
  const session = await getCustomerSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { confirm } = await req.json().catch(() => ({}));
  if (String(confirm ?? "").trim().toUpperCase() !== "DELETE") {
    return NextResponse.json({ error: "Please type DELETE to confirm" }, { status: 400 });
  }

  const result = await deleteCustomerAccount(session.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const response = NextResponse.json({ success: true });
  response.cookies.delete(getCustomerSessionCookieOptions().name);
  return response;
}
