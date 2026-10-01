import { NextRequest, NextResponse } from "next/server";
import { getTableByNumber, getOpenOrderForTable } from "@/lib/dine-in";
import { websiteBusinessId } from "@/lib/business";
import { customerForOrder } from "@/lib/customers";
import { getCustomerSessionFromRequest } from "@/lib/customer-auth";
import { bizDb } from "@/lib/business-db";

// Lets a customer submit their phone (for loyalty) independently of sending
// an order — e.g. they filled it in after already sending their first
// round. Attaches to whatever open order the table currently has; if there
// isn't one yet, it's a no-op (their next Send to Kitchen carries the same
// fields anyway).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tableNumber: string }> }
) {
  try {
    const { tableNumber } = await params;
    const businessId = await websiteBusinessId(req.headers.get("host"), req.nextUrl.searchParams.get("b"));
    const table = await getTableByNumber(businessId, tableNumber);
    if (!table) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    const { phone, name, email, marketing_consent } = await req.json();
    if (!phone || !String(phone).trim()) return NextResponse.json({ error: "Phone is required" }, { status: 400 });

    const order = await getOpenOrderForTable(businessId, table.id);
    if (!order) return NextResponse.json({ success: true, attached: false });

    const account = await getCustomerSessionFromRequest(req);
    const customerId = await customerForOrder(table.business_id, account?.id, String(phone).trim(), name || "Guest", email, marketing_consent === true);
    await bizDb(businessId)
      .from("orders")
      .update({ customer_id: customerId, customer_name: name || null, customer_phone: String(phone).trim() })
      .eq("id", order.id);

    return NextResponse.json({ success: true, attached: true });
  } catch (error) {
    console.error("Table customer-attach error:", error);
    return NextResponse.json({ error: "Failed to save details" }, { status: 500 });
  }
}
