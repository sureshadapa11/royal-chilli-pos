import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { findActiveByName } from "@/lib/unique-entry";
import { areaAllows } from "@/lib/permissions";

const EDITABLE_FIELDS = ["name", "contact_name", "phone", "email", "address", "notes", "active"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) if (field in body) updates[field] = body[field];
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    if (typeof updates.name === "string") {
      updates.name = updates.name.trim().replace(/\s+/g, " ");
      if (!updates.name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
      const existing = await findActiveByName("suppliers", updates.name as string, Number(id), session.businessId);
      if (existing) return NextResponse.json({ error: `"${existing.name}" is already in the supplier list` }, { status: 409 });
    }

    const { data, error } = await db.from("suppliers").update(updates).eq("id", id).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, supplier: data });
  } catch (error) {
    console.error("Supplier update error:", error);
    return NextResponse.json({ error: "Failed to update supplier" }, { status: 500 });
  }
}
