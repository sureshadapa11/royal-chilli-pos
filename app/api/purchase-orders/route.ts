import { NextRequest, NextResponse } from "next/server";
import { allOwned, bizDb, type BizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { londonDateStr, londonDayRangeUtc } from "@/lib/london-date";
import { poNumberPrefix } from "@/lib/business";
import { resolveInventoryLocation } from "@/lib/locations";
import { applyPoAction } from "@/lib/purchase-orders-server";

// Based on the highest sequence number actually issued today, not a row
// COUNT — a COUNT drifts (and reissues an already-used number, which then
// collides on the unique constraint) the moment any of today's purchase
// orders is deleted rather than just cancelled. Same fix as
// lib/orders.ts's generateOrderNumber().
async function generatePoNumber(db: BizDb, businessId: number): Promise<string> {
  const dateStr = londonDateStr().replace(/-/g, "");
  const prefix = `${await poNumberPrefix(businessId)}-${dateStr}-`;
  const { data: rows } = await db
    .from("purchase_orders")
    .select("order_number")
    .gte("created_at", londonDayRangeUtc(londonDateStr()).start)
    .like("order_number", `${prefix}%`);

  let maxSeq = 0;
  for (const r of rows ?? []) {
    const n = parseInt(String(r.order_number).slice(prefix.length), 10);
    if (!isNaN(n) && n > maxSeq) maxSeq = n;
  }
  return `${prefix}${(maxSeq + 1).toString().padStart(3, "0")}`;
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "inventory", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  let query = db.from("purchase_orders").select("*, supplier:suppliers(name)").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to fetch purchase orders" }, { status: 500 });
  const flat = (data || []).map((po) => {
    const { supplier: s, ...rest } = po as typeof po & { supplier: { name: string } | null };
    return { ...rest, supplier_name: s?.name ?? null };
  });
  return NextResponse.json({ purchaseOrders: flat });
}

// Creates a draft order, and with
// `submit: true` sends it straight on: approved if it's within the approval
// limit, otherwise waiting for a manager (lib/purchase-orders.ts).
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { supplier_id, expected_date, notes, items, submit } = await req.json();
    if (!supplier_id || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "supplier_id and at least one item are required" }, { status: 400 });
    }
    type Line = { ingredient_id: number; quantity: number; unit_cost: number };
    const lines: Line[] = items.map((i: Record<string, unknown>) => ({
      ingredient_id: Number(i.ingredient_id), quantity: Number(i.quantity), unit_cost: Number(i.unit_cost),
    }));
    if (lines.some((l) => !Number.isInteger(l.ingredient_id) || !(l.quantity > 0) || !Number.isFinite(l.unit_cost) || l.unit_cost < 0)) {
      return NextResponse.json({ error: "Every line needs an ingredient, a quantity above 0 and a price of £0 or more." }, { status: 400 });
    }
    if (!(await allOwned(db, "suppliers", [supplier_id]))) return NextResponse.json({ error: "That supplier isn't this business's" }, { status: 400 });

    if (!(await allOwned(db, "ingredients", lines.map((i) => i.ingredient_id)))) {
      return NextResponse.json({ error: "One of those ingredients isn't this business's" }, { status: 400 });
    }
    const location = await resolveInventoryLocation(session.businessId, session.id, null, session.owner);
    if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });
    const totalCost = lines.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);

    // generatePoNumber() isn't locked against a concurrent request landing on
    // the same next number — retry a couple of times with a freshly
    // regenerated number if the unique constraint catches a collision.
    let po: { id: number } | null = null;
    let poErr: { code?: string; message?: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const orderNumber = await generatePoNumber(db, session.businessId);
      const result = await db
        .from("purchase_orders")
        .insert({
          order_number: orderNumber,
          supplier_id,
          status: "draft",
          expected_date: expected_date || null,
          notes: notes || null,
          total_cost: Math.round(totalCost * 100) / 100,
          created_by: session.id,
          location_id: location.locationId,
        })
        .select()
        .single();
      po = result.data;
      poErr = result.error;
      if (!poErr || poErr.code !== "23505") break;
    }
    if (poErr) throw poErr;

    const itemRows = lines.map((i) => ({
      purchase_order_id: po!.id,
      ingredient_id: i.ingredient_id,
      quantity: i.quantity,
      unit_cost: i.unit_cost,
    }));
    const { error: itemsErr } = await db.from("purchase_order_items").insert(itemRows);
    if (itemsErr) throw itemsErr;

    if (submit) {
      const moved = await applyPoAction(session, po!.id, "submit");
      if (!moved.ok) return NextResponse.json({ error: moved.error, purchaseOrder: po }, { status: moved.status });
      return NextResponse.json({ success: true, purchaseOrder: moved.purchaseOrder }, { status: 201 });
    }
    return NextResponse.json({ success: true, purchaseOrder: po }, { status: 201 });
  } catch (error) {
    console.error("Purchase order create error:", error);
    return NextResponse.json({ error: "Failed to create purchase order" }, { status: 500 });
  }
}
