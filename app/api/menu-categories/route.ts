import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !manageAllows(session.role, "menu", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { data, error } = await db
    .from("menu_categories")
    .select("*")
    .order("display_order")
    .order("id");
  if (error) return NextResponse.json({ error: "Failed to fetch categories" }, { status: 500 });

  // Item count per category so the UI can warn before a delete.
  const { data: items } = await db.from("menu_items").select("category_id");
  const counts = new Map<number, number>();
  for (const i of items || []) counts.set(i.category_id, (counts.get(i.category_id) || 0) + 1);

  return NextResponse.json({
    categories: (data || []).map((c) => ({ ...c, item_count: counts.get(c.id) || 0 })),
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !manageAllows(session.role, "menu", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { name, color } = await req.json();
    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // New category goes to the end.
    const { data: last } = await db
      .from("menu_categories")
      .select("display_order")
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await db
      .from("menu_categories")
      .insert({
        name: String(name).trim(),
        color: color || "#f97316",
        display_order: (last?.display_order ?? 0) + 1,
        active: 1,
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, category: { ...data, item_count: 0 } }, { status: 201 });
  } catch (error) {
    console.error("Category create error:", error);
    return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
  }
}
