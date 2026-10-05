import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb } from "@/lib/business-db";
import { areaAllows } from "@/lib/permissions";
import { RECEIPT_BUCKET } from "@/lib/receipts";

// GET → redirects to a 5-minute signed link for one receipt photo. Only this
// business's photos, and only for staff who can see where it's used.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: photo } = await bizDb(session.businessId)
    .from("receipt_photos")
    .select("file_path, entity_type, uploaded_by")
    .eq("id", id)
    .maybeSingle();
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const area = photo.entity_type === "purchase_order" ? "inventory" : photo.entity_type ? "finance" : null;
  const ok = area ? areaAllows(session.role, area, "GET") : photo.uploaded_by === session.id;
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(photo.file_path, 300);
  if (error || !data) return NextResponse.json({ error: "Couldn't open the photo" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
