import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "drivers", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { data, error } = await db.from("delivery_zones").select("*").order("display_order");
  if (error) return NextResponse.json({ error: "Failed to fetch delivery zones" }, { status: 500 });
  return NextResponse.json({ zones: data });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "drivers", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { name, postcode_prefixes, fee, min_order } = await req.json();
    if (!name || !Array.isArray(postcode_prefixes) || postcode_prefixes.length === 0) {
      return NextResponse.json({ error: "name and at least one postcode prefix are required" }, { status: 400 });
    }

    const { data, error } = await db
      .from("delivery_zones")
      .insert({
        name,
        postcode_prefixes: postcode_prefixes.map((p: string) => p.trim().toUpperCase()),
        fee: fee || 0,
        min_order: min_order || 0,
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, zone: data }, { status: 201 });
  } catch (error) {
    console.error("Delivery zone create error:", error);
    return NextResponse.json({ error: "Failed to create delivery zone" }, { status: 500 });
  }
}
