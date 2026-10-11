import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

// PATCH { storage_area_id } — moved to another fridge/freezer (null = none).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;
    const { storage_area_id } = await req.json();

    const { data: batch } = await db.from("inventory_batches").select("id, location_id").eq("id", id).maybeSingle();
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    let areaId: number | null = null;
    if (storage_area_id != null && storage_area_id !== "") {
      areaId = Number(storage_area_id);
      const { data: area } = await db.from("storage_areas").select("id").eq("id", areaId)
        .eq("location_id", batch.location_id).eq("active", true).maybeSingle();
      if (!area) return NextResponse.json({ error: "That storage area isn't in this branch." }, { status: 400 });
    }
    const { error } = await db.from("inventory_batches").update({ storage_area_id: areaId }).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Batch move error:", error);
    return NextResponse.json({ error: "Failed to move the batch" }, { status: 500 });
  }
}

// POST — "Bin it": write off what's left of an expired batch as waste
// (bin_expired_batch, migration 118 — one transaction, batch locked).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const batchId = Number(id);
    if (!Number.isInteger(batchId) || batchId < 1) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

    const { data, error } = await supabase.rpc("bin_expired_batch", {
      p_business_id: session.businessId, p_batch_id: batchId, p_staff_id: session.id,
    });
    if (error) throw error;
    const result = data as { outcome: string; quantity?: number };
    if (result.outcome === "not_found") return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    if (result.outcome === "not_expired") return NextResponse.json({ error: "This batch hasn't passed its use-by yet." }, { status: 400 });
    if (result.outcome === "empty") return NextResponse.json({ error: "Nothing left in this batch — it's already been used or binned." }, { status: 409 });
    return NextResponse.json({ success: true, quantity: Number(result.quantity) });
  } catch (error) {
    console.error("Batch bin error:", error);
    return NextResponse.json({ error: "Failed to bin the batch" }, { status: 500 });
  }
}
