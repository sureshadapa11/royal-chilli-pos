import { NextRequest, NextResponse } from "next/server";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageStaff } from "@/lib/permissions";

const EDITABLE_FIELDS = [
  "category_id", "name", "description", "price", "online_price", "is_veg", "active", "display_order",
  "allergens", "calories", "protein_g", "carbs_g", "fat_g", "pos_available", "online_available", "image_url",
];
const INT_BOOL_FIELDS = ["is_veg", "active", "pos_available", "online_available"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !canManageStaff(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) if (field in body) updates[field] = body[field];
    // These are INT (0/1) columns — a JS boolean from the client would hit
    // Postgres as the literal string "true"/"false" and fail with 22P02.
    for (const field of INT_BOOL_FIELDS) if (field in updates) updates[field] = updates[field] ? 1 : 0;
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    if ("category_id" in updates && !(await allOwned(db, "menu_categories", [updates.category_id as number]))) {
      return NextResponse.json({ error: "That category isn't on this business's menu" }, { status: 400 });
    }

    const { data, error } = await db.from("menu_items").update(updates).eq("id", id).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, item: data });
  } catch (error) {
    console.error("Menu item update error:", error);
    return NextResponse.json({ error: "Failed to update menu item" }, { status: 500 });
  }
}
