import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { RECEIPT_BUCKET } from "@/lib/receipts";
import { linkStaff } from "@/lib/staff-links";

// A photo from a staff link (receipt for money out, or the Z report), checked
// on the phone first like the Staff Hub's (components/staff/ReceiptPhotos.tsx).
// multipart: file, sharpness, pin. Attached when the form is saved.
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 4 * 1024 * 1024;
const SHARP_MIN = 40;

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await req.formData().catch(() => null);
  const who = await linkStaff(token, form?.get("pin"));
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });

  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No photo" }, { status: 400 });
  if (!TYPES.has(file.type)) return NextResponse.json({ error: "Please use a photo (JPEG, PNG or WEBP)." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Photo is too large." }, { status: 400 });
  const sharpness = Number(form?.get("sharpness"));
  if (!(Number.isFinite(sharpness) && sharpness >= SHARP_MIN)) return NextResponse.json({ error: "The photo is blurry. Please retake it." }, { status: 422 });

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${who.businessId}/link/${new Date().toISOString().slice(0, 7)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (upErr) {
    console.error("Link photo upload error:", upErr);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
  const { data, error } = await bizDb(who.businessId).from("receipt_photos")
    .insert({ file_path: path, sharpness: Math.round(sharpness * 100) / 100, uploaded_by: who.staff.id })
    .select("id").single();
  if (error || !data) {
    await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
    return NextResponse.json({ error: "Couldn't save the photo" }, { status: 500 });
  }
  return NextResponse.json({ receipt: data }, { status: 201 });
}
