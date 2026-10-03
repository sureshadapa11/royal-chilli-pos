import { NextRequest, NextResponse } from "next/server";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !manageAllows(session.role, "settings", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { data, error } = await db
    .from("featured_dishes")
    .select("id, image_url, blurb, position, menu_item_id, menu_items(name, price)")
    .order("position");
  if (error) return NextResponse.json({ error: "Failed to fetch featured dishes" }, { status: 500 });
  return NextResponse.json({ dishes: data });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !manageAllows(session.role, "settings", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { menu_item_id, image_url, blurb } = await req.json();
  if (!menu_item_id || !image_url) {
    return NextResponse.json({ error: "menu_item_id and image_url are required" }, { status: 400 });
  }
  if (!(await allOwned(db, "menu_items", [menu_item_id]))) {
    return NextResponse.json({ error: "That dish isn't on this business's menu" }, { status: 400 });
  }

  const { data: existing } = await db.from("featured_dishes").select("position").order("position", { ascending: false }).limit(1);
  const nextPosition = existing?.[0] ? existing[0].position + 1 : 0;

  const { data, error } = await db
    .from("featured_dishes")
    .insert({ menu_item_id, image_url, blurb: blurb || null, position: nextPosition })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: "Failed to add featured dish" }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
