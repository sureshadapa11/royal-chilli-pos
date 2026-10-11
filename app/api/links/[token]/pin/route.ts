import { NextRequest, NextResponse } from "next/server";
import { linkStaff } from "@/lib/staff-links";

// POST { pin } → { name }: the form shows "✓ Anusha" before it's filled in.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const who = await linkStaff(token, body?.pin);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  return NextResponse.json({ name: who.staff.name });
}
