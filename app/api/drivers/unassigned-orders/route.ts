import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "drivers", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await bizDb(session.businessId)
    .from("orders")
    .select("id, order_number, customer_name, customer_phone, customer_address, total, created_at")
    .eq("order_type", "delivery")
    .eq("delivery_status", "unassigned")
    .not("status", "in", '("cancelled")')
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });

  return NextResponse.json({ orders: data });
}
