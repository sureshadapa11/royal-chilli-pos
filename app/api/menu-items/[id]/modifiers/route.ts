import { NextRequest, NextResponse } from "next/server";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest(req);
  if (!session || !manageAllows(session.role, "menu", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { id } = await params;
  if (!(await allOwned(db, "menu_items", [id]))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data, error } = await db.from("menu_item_modifier_groups").select("group_id, required").eq("menu_item_id", id);
  if (error) return NextResponse.json({ error: "Failed to fetch item modifiers" }, { status: 500 });
  return NextResponse.json({ attachments: data });
}

// Full-replace: pass the complete set of attached groups for this item.
export async function POST(
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
    const { attachments } = await req.json(); // [{ group_id, required }]
    if (!Array.isArray(attachments)) return NextResponse.json({ error: "attachments array is required" }, { status: 400 });
    if (!(await allOwned(db, "menu_items", [id]))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await allOwned(db, "modifier_groups", attachments.map((a: { group_id: number }) => a.group_id)))) {
      return NextResponse.json({ error: "One of those option groups isn't this business's" }, { status: 400 });
    }

    await db.from("menu_item_modifier_groups").delete().eq("menu_item_id", id);
    if (attachments.length > 0) {
      const rows = attachments.map((a: { group_id: number; required?: boolean }, i: number) => ({
        menu_item_id: Number(id), group_id: a.group_id, required: a.required ? 1 : 0, display_order: i,
      }));
      const { error } = await db.from("menu_item_modifier_groups").insert(rows);
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Item modifier attach error:", error);
    return NextResponse.json({ error: "Failed to update item modifiers" }, { status: 500 });
  }
}
