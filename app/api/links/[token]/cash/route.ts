import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { attachReceipts, checkReceiptsForSave } from "@/lib/receipts";
import { DATE_RE, linkStaff, money } from "@/lib/staff-links";
import { tradingDayStr } from "@/lib/london-date";
import { addDays } from "@/lib/admin-dashboard";

// POST — the Cash In / Out link: money put in or taken out of the drawer,
// with the reason staff type. Money out needs a receipt photo (as everywhere
// money goes out). Input only: the reply is just "saved".
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const who = await linkStaff(token, body?.pin);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });

  const direction = body?.direction === "in" ? "in" : body?.direction === "out" ? "out" : null;
  if (!direction) return NextResponse.json({ error: "Choose money in or money out." }, { status: 400 });
  const amount = money(body?.amount);
  if (amount === "bad" || amount == null || amount <= 0) return NextResponse.json({ error: "Enter the amount.", field: "amount" }, { status: 400 });
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (reason.length < 3) return NextResponse.json({ error: "Write the reason.", field: "reason" }, { status: 400 });
  const paidTo = typeof body?.paid_to === "string" ? body.paid_to.trim().slice(0, 120) || null : null;
  const today = tradingDayStr();
  const date = DATE_RE.test(String(body?.date ?? "")) ? String(body.date) : today;
  if (date > today || date < addDays(today, -31)) return NextResponse.json({ error: "Pick today or a day in the last month." }, { status: 400 });

  const db = bizDb(who.businessId);
  // The same entry again within 10 minutes (double tap, resend) is already saved.
  const { data: again } = await db.from("cash_movements").select("id")
    .eq("staff_id", who.staff.id).eq("direction", direction).eq("amount", amount).eq("movement_date", date).ilike("reason", reason)
    .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString()).limit(1);
  if (again?.length) return NextResponse.json({ ok: true, already: true });
  const photos = direction === "out" || (Array.isArray(body?.photo_ids) && body.photo_ids.length)
    ? await checkReceiptsForSave(db, body?.photo_ids) : null;
  if (photos && !photos.ok) return NextResponse.json({ error: photos.error }, { status: photos.status });

  const { data: saved, error } = await db.from("cash_movements").insert({
    movement_date: date, direction, amount, reason, paid_to: paidTo, staff_id: who.staff.id, source: "link",
  }).select("id").single();
  if (error || !saved) return NextResponse.json({ error: "Couldn't save. Please try again." }, { status: 500 });
  if (photos?.ok) await attachReceipts(db, photos.ids, "cash_movement", saved.id);
  return NextResponse.json({ ok: true });
}
