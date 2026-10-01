import { NextRequest, NextResponse } from "next/server";
import { getTableByNumber, getOpenOrderForTable, getOrderItems } from "@/lib/dine-in";
import { websiteBusinessId } from "@/lib/business";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tableNumber: string }> }
) {
  const { tableNumber } = await params;
  const businessId = await websiteBusinessId(req.headers.get("host"), req.nextUrl.searchParams.get("b"));
  const table = await getTableByNumber(businessId, tableNumber);
  if (!table) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }

  const order = await getOpenOrderForTable(businessId, table.id);
  const items = order ? await getOrderItems(businessId, order.id) : [];

  return NextResponse.json({
    table,
    order: order ? { id: order.id, order_number: order.order_number, status: order.status, total: order.total } : null,
    items,
  });
}
