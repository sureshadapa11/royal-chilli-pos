import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { allOwned, bizDb } from "@/lib/business-db";
import { staffIdsAt } from "@/lib/business";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "drivers", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const { driver_id } = await req.json();
    if (!driver_id) return NextResponse.json({ error: "driver_id is required" }, { status: 400 });

    const db = bizDb(session.businessId);
    if (!(await allOwned(db, "orders", [id]))) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const { data: driver } = await supabase.from("staff").select("id, can_deliver").eq("id", driver_id).eq("business_id", session.businessId).single();
    if (!driver || !driver.can_deliver || !(await staffIdsAt(session.businessId)).includes(driver.id)) {
      return NextResponse.json({ error: "That staff member can't deliver here — tick \"Can deliver\" in HR" }, { status: 400 });
    }

    const { data, error } = await db
      .from("orders")
      .update({ driver_id, delivery_status: "assigned", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, order: data });
  } catch (error) {
    console.error("Assign driver error:", error);
    return NextResponse.json({ error: "Failed to assign driver" }, { status: 500 });
  }
}
