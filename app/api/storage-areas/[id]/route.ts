import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

// DELETE — remove a fridge/freezer. It's hidden rather than deleted, so old
// batches still say where they were kept. Not while stock is still in it.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;

    const { count } = await db.from("inventory_batches").select("id", { count: "exact", head: true })
      .eq("storage_area_id", id).gt("remaining_qty", 0);
    if ((count ?? 0) > 0) {
      return NextResponse.json({ error: `${count} batch${count === 1 ? " is" : "es are"} still in it. Move ${count === 1 ? "it" : "them"} first.` }, { status: 409 });
    }
    const { data, error } = await db.from("storage_areas").update({ active: false }).eq("id", id).eq("active", true).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Storage area not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Storage area remove error:", error);
    return NextResponse.json({ error: "Failed to remove the storage area" }, { status: 500 });
  }
}
