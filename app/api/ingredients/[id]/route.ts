import { NextRequest, NextResponse } from "next/server";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { findActiveByName } from "@/lib/unique-entry";
import { canManageInventory } from "@/lib/permissions";

// current_stock is deliberately not editable here — it only changes via stock_movements,
// so there's always an audit trail for why stock went up or down.
const EDITABLE_FIELDS = ["name", "unit", "reorder_level", "reorder_quantity", "cost_per_unit", "supplier_id", "active"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !canManageInventory(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) if (field in body) updates[field] = body[field];
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    if (updates.supplier_id && !(await allOwned(db, "suppliers", [updates.supplier_id as number]))) return NextResponse.json({ error: "That supplier isn't this business's" }, { status: 400 });
    if (typeof updates.name === "string") {
      updates.name = updates.name.trim().replace(/\s+/g, " ");
      if (!updates.name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
      const { data: current } = await db.from("ingredients").select("location_id").eq("id", id).maybeSingle();
      const existing = await findActiveByName("ingredients", updates.name as string, Number(id), session.businessId, current?.location_id ?? undefined);
      if (existing) return NextResponse.json({ error: `"${existing.name}" is already an ingredient` }, { status: 409 });
    }

    const { data, error } = await db.from("ingredients").update(updates).eq("id", id).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, ingredient: data });
  } catch (error) {
    console.error("Ingredient update error:", error);
    return NextResponse.json({ error: "Failed to update ingredient" }, { status: 500 });
  }
}
