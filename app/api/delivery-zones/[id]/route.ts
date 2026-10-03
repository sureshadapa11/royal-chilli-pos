import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "drivers", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.postcode_prefixes !== undefined) updates.postcode_prefixes = body.postcode_prefixes.map((p: string) => p.trim().toUpperCase());
    if (body.fee !== undefined) updates.fee = body.fee;
    if (body.min_order !== undefined) updates.min_order = body.min_order;
    if (body.active !== undefined) updates.active = body.active;
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });

    const { data, error } = await db.from("delivery_zones").update(updates).eq("id", id).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, zone: data });
  } catch (error) {
    console.error("Delivery zone update error:", error);
    return NextResponse.json({ error: "Failed to update delivery zone" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "drivers", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;
    const { error } = await db.from("delivery_zones").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delivery zone delete error:", error);
    return NextResponse.json({ error: "Failed to delete delivery zone (it may be used on a past order)" }, { status: 500 });
  }
}
