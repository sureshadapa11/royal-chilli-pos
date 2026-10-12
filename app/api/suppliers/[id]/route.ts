import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
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
    // Bringing a removed supplier back mustn't make two with the same name.
    if (Number(updates.active) === 1 && typeof updates.name !== "string") {
      const { data: me } = await db.from("suppliers").select("name").eq("id", id).maybeSingle();
      const existing = me ? await findActiveByName("suppliers", me.name, Number(id), session.businessId) : null;
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

// Records that point at a supplier. Used ones are only hidden, so old
// orders, payments and Money OUT entries keep their supplier's name.
const USED_IN: { table: string; label: string }[] = [
  { table: "purchase_orders", label: "purchase order" },
  { table: "supplier_payments", label: "payment" },
  { table: "cash_movements", label: "Money In / Out entry" },
  { table: "ingredients", label: "ingredient" },
  { table: "fs_delivery_check", label: "delivery check" },
];

/**
 * DELETE — "Remove" in Inventory → Suppliers (agreed 2026-10-12): deleted
 * outright if nothing uses it, otherwise hidden (active = 0), bringable back.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const id = Number((await params).id);
    const { data: supplier } = await db.from("suppliers").select("id, name").eq("id", id).maybeSingle();
    if (!supplier) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });

    const counts = await Promise.all(USED_IN.map(async (u) => {
      const { count, error } = await supabase.from(u.table).select("id", { count: "exact", head: true }).eq("supplier_id", id);
      if (error) throw error;
      return { ...u, count: count ?? 0 };
    }));
    const used = counts.filter((c) => c.count > 0);
    if (used.length === 0) {
      const { error } = await db.from("suppliers").delete().eq("id", id);
      if (error) throw error;
      return NextResponse.json({ removed: "deleted", name: supplier.name });
    }
    const { error } = await db.from("suppliers").update({ active: 0 }).eq("id", id);
    if (error) throw error;
    const usedOn = used.map((u) => `${u.count} ${u.label}${u.count === 1 ? "" : "s"}`).join(", ");
    return NextResponse.json({ removed: "hidden", name: supplier.name, usedOn });
  } catch (error) {
    console.error("Supplier remove error:", error);
    return NextResponse.json({ error: "Couldn't remove the supplier" }, { status: 500 });
  }
}
