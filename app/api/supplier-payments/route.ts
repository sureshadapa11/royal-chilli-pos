import { NextRequest, NextResponse } from "next/server";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { londonDateStr, londonDayRangeUtc } from "@/lib/london-date";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "finance", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { data, error } = await db
    .from("supplier_payments")
    .select("*, supplier:suppliers(name)")
    .order("paid_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 });

  const flat = (data || []).map((p) => {
    const { supplier: s, ...rest } = p as typeof p & { supplier: { name: string } | null };
    return { ...rest, supplier_name: s?.name ?? null };
  });
  return NextResponse.json({ payments: flat });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "finance", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { supplier_id, purchase_order_id, amount, method, notes, allow_duplicate } = await req.json();
    if (!supplier_id || !amount) return NextResponse.json({ error: "supplier_id and amount are required" }, { status: 400 });
    if (!(await allOwned(db, "suppliers", [supplier_id]))) return NextResponse.json({ error: "That supplier isn't this business's" }, { status: 400 });
    if (!(Number(amount) > 0)) return NextResponse.json({ error: "Amount must be more than £0" }, { status: 400 });

    // Same payment to the same supplier on the same day is almost always a double entry — ask first.
    if (!allow_duplicate) {
      const { start, end } = londonDayRangeUtc(londonDateStr());
      const { data: same } = await db.from("supplier_payments").select("id")
        .eq("supplier_id", supplier_id).eq("amount", Math.round(Number(amount) * 100) / 100)
        .gte("paid_at", start).lte("paid_at", end).limit(1);
      if (same && same.length > 0) {
        return NextResponse.json({ error: "A payment of this amount to this supplier is already recorded today", duplicate: true }, { status: 409 });
      }
    }

    const { data, error } = await db
      .from("supplier_payments")
      .insert({ supplier_id, purchase_order_id: purchase_order_id || null, amount: Math.round(Number(amount) * 100) / 100, method: method || null, notes: notes || null, recorded_by: session.id })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, payment: data }, { status: 201 });
  } catch (error) {
    console.error("Supplier payment create error:", error);
    return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
  }
}
