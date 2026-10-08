import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { cleanPoLines } from "@/lib/purchase-orders";

// PUT { items: [{ ingredient_id, quantity, unit_cost }] } — change a draft's
// lines. Only a draft: once it's placed or sent for approval it's locked
// (replace_draft_po_lines, migration 116, checks that under a row lock).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;
    const poId = Number(id);
    if (!Number.isInteger(poId) || poId < 1) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

    const checked = cleanPoLines((await req.json()).items);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    if (!(await allOwned(db, "ingredients", checked.lines.map((l) => l.ingredient_id)))) {
      return NextResponse.json({ error: "One of those ingredients isn't this business's" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("replace_draft_po_lines", {
      p_business_id: session.businessId,
      p_po_id: poId,
      p_items: checked.lines,
      p_staff_id: session.id,
    });
    if (error) throw error;
    const result = data as { outcome: string; status?: string; purchase_order?: Record<string, unknown> };
    if (result.outcome === "not_found") return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (result.outcome !== "saved") {
      return NextResponse.json({ error: "Only a draft can be changed. Copy it to a new order instead." }, { status: 409 });
    }
    return NextResponse.json({ success: true, purchaseOrder: result.purchase_order });
  } catch (error) {
    console.error("Purchase order lines update error:", error);
    return NextResponse.json({ error: "Failed to save the order" }, { status: 500 });
  }
}
