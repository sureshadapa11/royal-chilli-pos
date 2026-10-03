import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !manageAllows(session.role, "settings", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { id } = await params;
  const updates = await req.json();
  const allowed: Record<string, unknown> = {};
  if (updates.blurb !== undefined) allowed.blurb = updates.blurb || null;
  if (updates.position !== undefined) allowed.position = updates.position;

  const { error } = await db.from("featured_dishes").update(allowed).eq("id", id);
  if (error) return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !manageAllows(session.role, "settings", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { id } = await params;
  const { error } = await db.from("featured_dishes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  return NextResponse.json({ success: true });
}
