import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { platformCommission } from "@/lib/daily-accounts-fields";
import { attachReceipts, checkReceiptsForSave } from "@/lib/receipts";
import { DATE_RE, linkStaff, money } from "@/lib/staff-links";
import { tradingDayStr } from "@/lib/london-date";
import { addDays } from "@/lib/admin-dashboard";
import { parseBill, addBillPayment } from "@/lib/pending-bills-save";
import { getBill } from "@/lib/pending-bills";

// POST — the Day End link. One per trading day: once a day is submitted
// (here or in the Staff Hub) it's locked, and only a manager can change it in
// Staff Hub → Daily accounts. Nothing is read back: the reply is just "saved".
// Opening, bank in and pending are typed (agreed 2026-10-11); if the opening
// is left blank it's yesterday's counted closing.
const FIELDS = [
  "z_report", "card", "cash", "tips",
  "just_eat", "just_eat_commission", "deliveroo", "deliveroo_commission",
  "uber_eats", "uber_eats_commission", "hiest", "hiest_commission",
  "catering_paid", "catering_pending", "opening_balance", "closing_balance", "bank_in", "pending",
] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const who = await linkStaff(token, body?.pin);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });

  const date = String(body?.date ?? "");
  const today = tradingDayStr();
  if (!DATE_RE.test(date) || date > today) return NextResponse.json({ error: "Pick today or an earlier day." }, { status: 400 });
  if (date < addDays(today, -31)) return NextResponse.json({ error: "That day is too long ago. Ask a manager to enter it in the Staff Hub." }, { status: 400 });

  const values: Record<string, number | null> = {};
  for (const k of FIELDS) {
    const v = money(body?.values?.[k]);
    if (v === "bad") return NextResponse.json({ error: "Amounts must be numbers, zero or more.", field: k }, { status: 400 });
    values[k] = v;
  }
  if (values.z_report == null) return NextResponse.json({ error: "Enter the Z report total (0 if closed).", field: "z_report" }, { status: 400 });
  values.commission = platformCommission(values as Parameters<typeof platformCommission>[0]);

  // Pending bills (134): new unpaid bills and old bills paid, checked before
  // anything is saved. Tracking only — not sales, not the cash check.
  const newBills = [];
  for (const b of Array.isArray(body?.new_bills) ? body.new_bills.slice(0, 20) : []) {
    const bill = parseBill(b, date);
    if ("error" in bill) return NextResponse.json({ error: bill.error }, { status: 400 });
    newBills.push({ ...bill, bill_date: date });
  }
  const paidBills: { bill_id: number; amount: unknown; method: unknown }[] = Array.isArray(body?.bills_paid) ? body.bills_paid.slice(0, 20) : [];
  const paidPerBill = new Map<number, number>();
  for (const p of paidBills) {
    const bill = await getBill(who.businessId, Number(p.bill_id));
    if (!bill || bill.cancelled) return NextResponse.json({ error: "One of the bills paid isn't on the list any more. Remove it and try again." }, { status: 400 });
    // Two lines for the same bill can't add up to more than it owes.
    const sum = (paidPerBill.get(bill.id) ?? 0) + Number(p.amount);
    paidPerBill.set(bill.id, sum);
    if (!(Number(p.amount) > 0) || sum > bill.owed + 0.001) return NextResponse.json({ error: `Only £${bill.owed.toFixed(2)} is owed by ${bill.customer}.` }, { status: 400 });
  }

  const db = bizDb(who.businessId);
  const { data: existing } = await db.from("daily_accounts").select("status").eq("trading_date", date).maybeSingle();
  if (existing?.status === "submitted") {
    return NextResponse.json({ error: "This day has already been entered. Ask a manager if something needs changing." }, { status: 409 });
  }

  const photos = Array.isArray(body?.photo_ids) && body.photo_ids.length ? await checkReceiptsForSave(db, body.photo_ids) : null;
  if (photos && !photos.ok) return NextResponse.json({ error: photos.error }, { status: photos.status });

  // Opening cash, if left blank = what the last entered day left in the till:
  // counted − cash taken to the Safe (136), i.e. the float.
  const { data: before } = await db.from("daily_accounts").select("closing_balance, bank_in")
    .lt("trading_date", date).not("closing_balance", "is", null).order("trading_date", { ascending: false }).limit(1).maybeSingle();

  const now = new Date().toISOString();
  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 1000) || null : null;
  // One row per business per day (unique). A new day is inserted; a draft
  // started in the Staff Hub is filled in — but only while it's still a draft,
  // so two people sending the same day at once can't both get through.
  const row = {
    trading_date: date, ...values,
    opening_balance: values.opening_balance ?? (before ? Math.round((Number(before.closing_balance) - Number(before.bank_in ?? 0)) * 100) / 100 : null),
    notes, status: "submitted", submitted_by: who.staff.id, submitted_at: now, submitted_via: "link",
    updated_by: who.staff.id, updated_at: now,
  };
  let saved: { id: number } | null = null;
  if (!existing) {
    const ins = await db.from("daily_accounts").insert(row).select("id").single();
    if (!ins.error) saved = ins.data;
    else if (ins.error.code !== "23505") return NextResponse.json({ error: "Couldn't save. Please try again." }, { status: 500 });
  }
  if (!saved) {
    const upd = await db.from("daily_accounts").update(row).eq("trading_date", date).neq("status", "submitted").select("id");
    if (upd.error) return NextResponse.json({ error: "Couldn't save. Please try again." }, { status: 500 });
    saved = upd.data?.[0] ?? null;
  }
  if (!saved) return NextResponse.json({ error: "This day has already been entered. Ask a manager if something needs changing." }, { status: 409 });

  if (photos?.ok) await attachReceipts(db, photos.ids, "daily_account", saved.id);
  // The day is saved; a bill that didn't save is reported so it can be added in Pending bills.
  const failed: string[] = [];
  if (newBills.length) {
    const { error } = await db.from("pending_bills").insert(newBills.map((b) => ({ ...b, created_by: who.staff.id, source: "link" })));
    if (error) failed.push("the unpaid bills");
  }
  for (const p of paidBills) {
    const res = await addBillPayment(who.businessId, Number(p.bill_id), who.staff.id, { amount: p.amount, method: p.method, date }, "link");
    if ("error" in res) failed.push("a bill payment");
  }
  await db.from("audit_logs").insert({
    staff_id: who.staff.id, action: "daily_accounts_submitted_link", entity_type: "daily_accounts", entity_id: saved.id,
    changes: { date, values, notes, ...(failed.length ? { failed } : {}) },
  });
  if (failed.length) return NextResponse.json({ error: `The Day End is saved, but ${[...new Set(failed)].join(" and ")} didn't save. Ask a manager to add them in Daily accounts → Pending bills.` }, { status: 500 });
  return NextResponse.json({ ok: true });
}
