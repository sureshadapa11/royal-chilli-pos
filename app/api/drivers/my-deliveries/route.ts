import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await bizDb(session.businessId)
    .from("orders")
    .select("id, order_number, customer_name, customer_phone, customer_address, total, amount_paid, delivery_status")
    .eq("driver_id", session.id)
    .in("delivery_status", ["assigned", "out_for_delivery"])
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Failed to fetch deliveries" }, { status: 500 });

  return NextResponse.json({ deliveries: data });
}
