import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb, staffWorksAt } from "@/lib/business-db";
import { areaAllows } from "@/lib/permissions";
import { ONBOARDING_TASKS } from "@/lib/hr";

// Rows are created lazily the first time a staff member's checklist is
// viewed, rather than on staff creation, so ONBOARDING_TASKS can gain new
// entries later without a backfill migration for every existing employee.
export async function GET(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { staffId } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const staffIdNum = Number(staffId);

  const { data: existing } = await supabase.from("staff_onboarding_tasks").select("*").eq("staff_id", staffIdNum);
  const existingKeys = new Set((existing || []).map((t) => t.task_key));

  const missing = ONBOARDING_TASKS.filter((t) => !existingKeys.has(t.key));
  if (missing.length > 0) {
    await supabase.from("staff_onboarding_tasks").insert(
      missing.map((t) => ({ staff_id: staffIdNum, task_key: t.key }))
    );
  }

  const { data: rows } = await supabase.from("staff_onboarding_tasks").select("*").eq("staff_id", staffIdNum);
  const byKey = new Map((rows || []).map((r) => [r.task_key, r]));

  const tasks = ONBOARDING_TASKS.map((t) => ({
    ...t,
    ...(byKey.get(t.key) || { status: "not_started", notes: null, completed_at: null }),
  }));

  return NextResponse.json({ tasks });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { staffId } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const { task_key, status, notes } = await req.json();
  if (!task_key || !status) return NextResponse.json({ error: "task_key and status are required" }, { status: 400 });

  const update: Record<string, unknown> = {
    status,
    notes: notes ?? null,
    completed_at: status === "done" ? new Date().toISOString() : null,
    completed_by: status === "done" ? session.id : null,
  };

  const { error } = await supabase
    .from("staff_onboarding_tasks")
    .upsert({ staff_id: Number(staffId), task_key, ...update }, { onConflict: "staff_id,task_key" });
  if (error) {
    console.error("Onboarding task update error:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
