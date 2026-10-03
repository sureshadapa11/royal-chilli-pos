import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb, staffWorksAt } from "@/lib/business-db";
import { areaAllows } from "@/lib/permissions";

const BUCKET = "employee-documents";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const DOC_TYPES = new Set(["passport", "visa_brp", "p45_starter", "contract", "certificate", "reference", "other"]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { staffId } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const { data, error } = await supabase
    .from("employee_documents")
    .select("id, doc_type, file_name, expiry_date, uploaded_by, created_at")
    .eq("staff_id", staffId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Failed to fetch documents" }, { status: 500 });
  return NextResponse.json({ documents: data });
}

// multipart: file, doc_type, expiry_date? — stored privately, only ever
// served back out via a short-lived signed URL (see [id]/url).
export async function POST(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { staffId } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG, WEBP or PDF files are allowed" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be 10MB or smaller" }, { status: 400 });
  }

  const docTypeInput = form.get("doc_type");
  const docType = typeof docTypeInput === "string" && DOC_TYPES.has(docTypeInput) ? docTypeInput : "other";
  const expiryInput = form.get("expiry_date");
  const expiryDate = typeof expiryInput === "string" && expiryInput.trim() ? expiryInput.trim() : null;

  const ext = file.name.split(".").pop() || "bin";
  const path = `${staffId}/${docType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (uploadErr) {
    console.error("Employee document upload error:", uploadErr);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("employee_documents")
    .insert({
      staff_id: Number(staffId),
      doc_type: docType,
      file_path: path,
      file_name: file.name,
      expiry_date: expiryDate,
      uploaded_by: session.id,
    })
    .select("id, doc_type, file_name, expiry_date, uploaded_by, created_at")
    .single();
  if (error) {
    // Don't leave an orphaned file in storage if the DB insert failed.
    await supabase.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: "Failed to save document record" }, { status: 500 });
  }

  return NextResponse.json({ success: true, document: data }, { status: 201 });
}
