import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb } from "@/lib/business-db";
import { areaAllows } from "@/lib/permissions";
import { checkReceiptWithAI, receiptsFor, RECEIPT_BUCKET, RECEIPT_ENTITIES, type ReceiptEntity } from "@/lib/receipts";
import type { SessionUser } from "@/lib/types";

export const maxDuration = 60;

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 4 * 1024 * 1024; // the phone shrinks photos to well under this

const AREA: Record<ReceiptEntity, "finance" | "inventory"> = {
  expense: "finance", supplier_payment: "finance", purchase_order: "inventory",
};
const asEntity = (v: unknown): ReceiptEntity | null =>
  RECEIPT_ENTITIES.includes(v as ReceiptEntity) ? (v as ReceiptEntity) : null;
const allowed = (s: SessionUser, e: ReceiptEntity, method: string) => areaAllows(s.role, AREA[e], method);

/** GET ?entity=expense&ids=1,2,3 → { receipts: { "1": [{ id, ai_status, amount_mismatch }] } } */
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const entity = asEntity(req.nextUrl.searchParams.get("entity"));
  if (!session || !entity || !allowed(session, entity, "GET")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  const map = await receiptsFor(bizDb(session.businessId), entity, ids);
  return NextResponse.json({ receipts: Object.fromEntries(map) });
}

/**
 * multipart: file (JPEG/PNG/WEBP), entity (what it's for), sharpness (the
 * phone's blur score). Stores the photo privately and reads it with AI. A
 * photo the AI rejects isn't kept — the response says why, to retake it.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const entity = asEntity(form?.get("entity"));
  if (!entity || !allowed(session, entity, "POST")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No photo" }, { status: 400 });
  if (!TYPES.has(file.type)) return NextResponse.json({ error: "Please use a photo (JPEG, PNG or WEBP)." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Photo is too large." }, { status: 400 });
  const sharpnessRaw = Number(form?.get("sharpness"));
  const sharpness = Number.isFinite(sharpnessRaw) && sharpnessRaw >= 0 ? Math.round(sharpnessRaw * 100) / 100 : null;

  const bytes = Buffer.from(await file.arrayBuffer());
  const check = await checkReceiptWithAI(bytes, file.type as "image/jpeg" | "image/png" | "image/webp");
  if (check.status === "failed") {
    return NextResponse.json({ error: check.reason || "This photo can't be read. Please retake it.", rejected: true }, { status: 422 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${session.businessId}/${entity}/${new Date().toISOString().slice(0, 7)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) {
    console.error("Receipt upload error:", upErr);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  const { data, error } = await bizDb(session.businessId)
    .from("receipt_photos")
    .insert({
      file_path: path, sharpness,
      ai_status: check.status, ai_supplier: check.supplier, ai_date: check.date, ai_total: check.total, ai_reason: check.reason,
      uploaded_by: session.id,
    })
    .select("id, ai_status, ai_supplier, ai_date, ai_total, ai_reason")
    .single();
  if (error || !data) {
    await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
    return NextResponse.json({ error: "Couldn't save the photo" }, { status: 500 });
  }
  return NextResponse.json({ receipt: data }, { status: 201 });
}
