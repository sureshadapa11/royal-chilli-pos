import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { mayApprove } from "@/lib/purchase-orders";
import { poActor } from "@/lib/purchase-orders-server";

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

  const [{ data: items, error: itemsErr }, { data: events }, { data: requests }] = await Promise.all([
    db.from("purchase_order_items").select("*, ingredient:ingredients(name, unit)").eq("purchase_order_id", id),
    db.from("purchase_order_events").select("id, action, from_status, to_status, comment, created_at, staff:staff(name)").eq("purchase_order_id", id).order("id"),
    db.from("stock_requests").select("id, quantity, unit, reason, item_name, ingredient:ingredients(name), requester:staff!stock_requests_requested_by_fkey(name)").eq("purchase_order_id", id),
  ]);
  if (itemsErr) return NextResponse.json({ error: "Failed to fetch items" }, { status: 500 });

  const { supplier: s, ...poRest } = po as typeof po & { supplier: { name: string } | null };
  const flatItems = (items || []).map((i) => {
    const { ingredient: ing, ...rest } = i as typeof i & { ingredient: { name: string; unit: string } | null };
    return { ...rest, ingredient_name: ing?.name ?? null, unit: ing?.unit ?? null };
  });
  const history = (events || []).map((e) => {
    const { staff, ...rest } = e as typeof e & { staff: { name: string } | null };
    return { ...rest, staff_name: staff?.name ?? null };
  });
  const fromKitchen = (requests || []).map((r) => {
    const { ingredient, requester, ...rest } = r as typeof r & { ingredient: { name: string } | null; requester: { name: string } | null };
    return { ...rest, name: ingredient?.name ?? r.item_name, requested_by_name: requester?.name ?? null };
  });

  return NextResponse.json({
    purchaseOrder: { ...poRest, supplier_name: s?.name ?? null },
    items: flatItems,
    events: history,
    requests: fromKitchen,
    canApprove: mayApprove(po, poActor(session)),
  });
}

// Expected date and notes only. Stages change through /action (lib/purchase-orders.ts).
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
    const { expected_date, notes } = await req.json();

    const updates: Record<string, unknown> = {};
    if (expected_date !== undefined) updates.expected_date = expected_date || null;
    if (notes !== undefined) updates.notes = notes || null;
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });

    const { data, error } = await db.from("purchase_orders").update(updates).eq("id", id).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, purchaseOrder: data });
  } catch (error) {
    console.error("Purchase order update error:", error);
    return NextResponse.json({ error: "Failed to update purchase order" }, { status: 500 });
  }
}
