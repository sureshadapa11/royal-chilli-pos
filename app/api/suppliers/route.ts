import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { findActiveByName } from "@/lib/unique-entry";
import { areaAllows } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "inventory", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { searchParams } = new URL(req.url);
  const activeParam = searchParams.get("active") ?? "1";

  let query = db.from("suppliers").select("*").order("name");
  if (activeParam !== "all") query = query.eq("active", Number(activeParam));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to fetch suppliers" }, { status: 500 });
  return NextResponse.json({ suppliers: data });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { name, contact_name, phone, email, address, notes } = await req.json();
    if (!name || !String(name).trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    const existing = await findActiveByName("suppliers", String(name), undefined, session.businessId);
    if (existing) return NextResponse.json({ error: `"${existing.name}" is already in the supplier list` }, { status: 409 });

    const { data, error } = await db
      .from("suppliers")
      .insert({ name: String(name).trim().replace(/\s+/g, " "), contact_name: contact_name || null, phone: phone || null, email: email || null, address: address || null, notes: notes || null })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, supplier: data }, { status: 201 });
  } catch (error) {
    console.error("Supplier create error:", error);
    return NextResponse.json({ error: "Failed to create supplier" }, { status: 500 });
  }
}
