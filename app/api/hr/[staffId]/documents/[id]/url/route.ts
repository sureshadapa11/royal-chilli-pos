import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb, staffWorksAt } from "@/lib/business-db";
import { areaAllows } from "@/lib/permissions";

const BUCKET = "employee-documents";

// Short-lived signed URL — the bucket is private, so this is the only way
// to ever view a document. Never returns a permanent/public link.
export async function GET(req: NextRequest, { params }: { params: Promise<{ staffId: string; id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { staffId, id } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });

  const { data: doc } = await supabase
    .from("employee_documents")
    .select("file_path")
    .eq("id", id)
    .eq("staff_id", staffId)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 300);
  if (error || !data) return NextResponse.json({ error: "Failed to create link" }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
