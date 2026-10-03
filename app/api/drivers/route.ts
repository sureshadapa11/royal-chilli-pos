import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { staffIdsAt } from "@/lib/business";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "drivers", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: drivers, error } = await supabase
    .from("staff")
    .select("id, name, phone, vehicle_type, vehicle_registration, driver_status")
    .eq("can_deliver", true)
    .eq("active", 1)
    .in("id", await staffIdsAt(session.businessId));
  if (error) return NextResponse.json({ error: "Failed to fetch drivers" }, { status: 500 });

  const { data: deliveries } = await bizDb(session.businessId)
    .from("orders")
    .select("driver_id, total, delivery_status")
    .eq("order_type", "delivery")
    .not("driver_id", "is", null);

  const perfByDriver = new Map<number, { delivered: number; total_value: number }>();
  for (const d of deliveries || []) {
    const cur = perfByDriver.get(d.driver_id) || { delivered: 0, total_value: 0 };
    if (d.delivery_status === "delivered") {
      cur.delivered += 1;
      cur.total_value += Number(d.total);
    }
    perfByDriver.set(d.driver_id, cur);
  }

  const enriched = (drivers || []).map((d) => ({
    ...d,
    delivered_count: perfByDriver.get(d.id)?.delivered || 0,
    delivered_value: Math.round((perfByDriver.get(d.id)?.total_value || 0) * 100) / 100,
  }));

  return NextResponse.json({ drivers: enriched });
}
