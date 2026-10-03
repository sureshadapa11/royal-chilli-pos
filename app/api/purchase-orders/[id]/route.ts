import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "inventory", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { id } = await params;

  const { data: po, error: poErr } = await db.from("purchase_orders").select("*, supplier:suppliers(name)").eq("id", id).single();
  if (poErr || !po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

  const { data: items, error: itemsErr } = await db
    .from("purchase_order_items")
    .select("*, ingredient:ingredients(name, unit)")
    .eq("purchase_order_id", id);
  if (itemsErr) return NextResponse.json({ error: "Failed to fetch items" }, { status: 500 });

  const { supplier: s, ...poRest } = po as typeof po & { supplier: { name: string } | null };
  const flatItems = (items || []).map((i) => {
    const { ingredient: ing, ...rest } = i as typeof i & { ingredient: { name: string; unit: string } | null };
    return { ...rest, ingredient_name: ing?.name ?? null, unit: ing?.unit ?? null };
  });

  return NextResponse.json({ purchaseOrder: { ...poRest, supplier_name: s?.name ?? null }, items: flatItems });
}

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
    const { status, expected_date, notes } = await req.json();

    const updates: Record<string, unknown> = {};
    if (status && ["draft", "ordered", "cancelled"].includes(status)) updates.status = status;
    if (expected_date !== undefined) updates.expected_date = expected_date;
    if (notes !== undefined) updates.notes = notes;
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });

    const { data, error } = await db.from("purchase_orders").update(updates).eq("id", id).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, purchaseOrder: data });
  } catch (error) {
    console.error("Purchase order update error:", error);
    return NextResponse.json({ error: "Failed to update purchase order" }, { status: 500 });
  }
}
