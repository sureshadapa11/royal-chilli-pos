import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb, staffWorksAt } from "@/lib/business-db";
import { areaAllows } from "@/lib/permissions";

export async function GET(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { staffId } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const { data, error } = await supabase
    .from("staff_references")
    .select("*")
    .eq("staff_id", staffId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Failed to fetch references" }, { status: 500 });
  return NextResponse.json({ references: data });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { staffId } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const body = await req.json();

  const { data, error } = await supabase
    .from("staff_references")
    .insert({
      staff_id: Number(staffId),
      employer_name: body.employer_name || null,
      job_title: body.job_title || null,
      employment_dates: body.employment_dates || null,
      referee_name: body.referee_name || null,
      referee_contact: body.referee_contact || null,
      may_contact: body.may_contact ?? null,
      qualification: body.qualification || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: "Failed to save reference" }, { status: 500 });

  return NextResponse.json({ success: true, reference: data }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { staffId } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Only this staff member's reference.
  const { error } = await supabase.from("staff_references").delete().eq("id", id).eq("staff_id", staffId);
  if (error) return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  return NextResponse.json({ success: true });
}
