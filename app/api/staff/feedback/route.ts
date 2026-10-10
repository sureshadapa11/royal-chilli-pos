import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { bizDb } from "@/lib/business-db";
import { summariseFeedback, NEEDS_CALL_BACK, type FeedbackRow } from "@/lib/feedback";

// Staff Hub → Customers → Feedback.
// GET ?days=30 — the period's feedback (newest first) and its summary, plus
//   every 1–3★ still waiting for a call back, however old.
// PATCH { id, note } — mark a 1–3★ as called back / handled, with a note.

const COLUMNS = "id, created_at, rating, liked, improve, comment, name, phone, email, contact_ok, customer_id, source, table_label, handled_at, handled_note";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "customers", req.method)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = bizDb(session.businessId);
  const [{ data: rows, error }, { data: open }] = await Promise.all([
    db.from("guest_feedback").select(COLUMNS).gte("created_at", since).order("created_at", { ascending: false }).limit(500),
    db.from("guest_feedback").select(COLUMNS).lte("rating", NEEDS_CALL_BACK).is("handled_at", null).order("created_at", { ascending: false }).limit(200),
  ]);
  if (error) return NextResponse.json({ error: "Couldn't load feedback" }, { status: 500 });
  const list = (rows ?? []) as FeedbackRow[];
  return NextResponse.json({ days, rows: list, open: open ?? [], summary: summariseFeedback(list) });
}

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "customers", req.method)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Pick some feedback" }, { status: 400 });
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) || null : null;
  const reopen = body?.reopen === true;
  const { error } = await bizDb(session.businessId).from("guest_feedback")
    .update(reopen ? { handled_at: null, handled_by: null, handled_note: null } : { handled_at: new Date().toISOString(), handled_by: session.id, handled_note: note })
    .eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't save" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
