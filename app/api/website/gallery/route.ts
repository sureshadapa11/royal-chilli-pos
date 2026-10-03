import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";

// Staff Hub → Website → Menu & photos → Gallery: the photos on this
// business's website Gallery page (website_gallery). Upload the file first
// with /api/site-content/upload (folder "gallery"), then POST its url here.

async function guard(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canAccess(session.role, "website")) return null;
  return session;
}

export async function GET(req: NextRequest) {
  const session = await guard(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await bizDb(session.businessId)
    .from("website_gallery").select("id, image_url, caption, position").order("position").order("id");
  if (error) return NextResponse.json({ error: "Couldn't load the gallery" }, { status: 500 });
  return NextResponse.json({ photos: data ?? [] });
}

// POST { image_url, caption? }
export async function POST(req: NextRequest) {
  const session = await guard(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const url = typeof body?.image_url === "string" ? body.image_url : "";
  if (!/^https:\/\/[^/]+\.supabase\.co\/storage\//.test(url)) {
    return NextResponse.json({ error: "Upload the photo first" }, { status: 400 });
  }
  const caption = typeof body?.caption === "string" ? body.caption.trim().slice(0, 80) || null : null;
  const db = bizDb(session.businessId);
  const { data: last } = await db.from("website_gallery").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db
    .from("website_gallery")
    .insert({ image_url: url, caption, position: ((last as { position: number } | null)?.position ?? 0) + 1 })
    .select("id, image_url, caption, position")
    .single();
  if (error) return NextResponse.json({ error: "Couldn't add the photo" }, { status: 500 });
  return NextResponse.json({ photo: data });
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  const session = await guard(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const { error } = await bizDb(session.businessId).from("website_gallery").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't remove the photo" }, { status: 500 });
  return NextResponse.json({ success: true });
}
