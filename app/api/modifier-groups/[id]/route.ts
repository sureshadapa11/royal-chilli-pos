import { NextRequest, NextResponse } from "next/server";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !manageAllows(session.role, "menu", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;
    if (!(await allOwned(db, "modifier_groups", [id]))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { name, selection_type, min_select, max_select, options } = await req.json();

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (selection_type !== undefined) updates.selection_type = selection_type;
    if (min_select !== undefined) updates.min_select = min_select;
    if (max_select !== undefined) updates.max_select = max_select;
    if (Object.keys(updates).length > 0) {
      const { error } = await db.from("modifier_groups").update(updates).eq("id", id);
      if (error) throw error;
    }

    // Full-replace the option list, same pattern as recipe ingredients.
    if (Array.isArray(options)) {
      await db.from("modifier_options").delete().eq("group_id", id);
      if (options.length > 0) {
        const rows = options.map((o: { name: string; price_delta?: number }, i: number) => ({
          group_id: Number(id), name: o.name, price_delta: o.price_delta || 0, display_order: i,
        }));
        const { error: optErr } = await db.from("modifier_options").insert(rows);
        if (optErr) throw optErr;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Modifier group update error:", error);
    return NextResponse.json({ error: "Failed to update modifier group" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !manageAllows(session.role, "menu", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;
    const { error } = await db.from("modifier_groups").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Modifier group delete error:", error);
    return NextResponse.json({ error: "Failed to delete modifier group (it may be used on a past order)" }, { status: 500 });
  }
}
