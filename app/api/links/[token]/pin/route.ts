import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { linkStaff } from "@/lib/staff-links";

// POST { pin } → { name, staff, suppliers }: the form shows "✓ Anusha", and —
// only once the PIN is right — the names to pick for wages / advances and
// supplier payments. Names only, never any figures.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const who = await linkStaff(token, body?.pin);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const db = bizDb(who.businessId);
  const [{ data: staff }, { data: suppliers }] = await Promise.all([
    db.from("staff").select("id, name").eq("active", 1).order("name"),
    db.from("suppliers").select("id, name").order("name"),
  ]);
  return NextResponse.json({ name: who.staff.name, staff: staff ?? [], suppliers: suppliers ?? [] });
}
