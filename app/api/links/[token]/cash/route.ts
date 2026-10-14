import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { attachReceipts, checkReceiptsForSave, type ReceiptEntity } from "@/lib/receipts";
import { DATE_RE, linkStaff, money, payableStaff } from "@/lib/staff-links";
import { addJobPayment, parseJob } from "@/lib/catering-jobs-save";
import { cashCategory, payMethodLabel } from "@/lib/cash-categories";
import { tradingDayStr, londonDayRangeUtc } from "@/lib/london-date";
import { addDays } from "@/lib/admin-dashboard";

// POST — the Money In / Out link (cash, card or bank transfer). Every entry has a category, and each
// category has ONE home (lib/cash-categories.ts): an expense is created as
// the expense itself, a supplier payment as the supplier payment, an advance
// in staff advances — so nobody enters it again in the Staff Hub. The same
// category + amount on the same day asks "is this a different one?" first.
// Input only: the reply is "saved" (or that question), never figures.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const who = await linkStaff(token, body?.pin);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });

  const cat = cashCategory(String(body?.category ?? ""));
  if (!cat || cat.hidden) return NextResponse.json({ error: "Choose what it was for." }, { status: 400 });
  const amount = money(body?.amount);
  if (amount === "bad" || amount == null || amount <= 0) return NextResponse.json({ error: "Enter the amount.", field: "amount" }, { status: 400 });
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (cat.reasonRequired && reason.length < 3) return NextResponse.json({ error: "Write what it was for.", field: "reason" }, { status: 400 });
  // Safe-only entries (Paid into bank / Given to owner) are always Safe cash (136).
  const method = cat.safeOnly ? "cash" : body?.method === "card" || body?.method === "bank" ? body.method : "cash";
  // Cash goes through the Safe (136): the till only holds the float and cash sales.
  const place = method === "cash" ? "safe" : "till";
  const paidTo = typeof body?.paid_to === "string" ? body.paid_to.trim().slice(0, 120) || null : null;
  // VAT is always answered for an expense, never assumed (2026-10-14).
  if (cat.home === "expense" && typeof body?.vat !== "boolean") return NextResponse.json({ error: "Does the receipt show VAT? Choose Yes or No.", field: "vat" }, { status: 400 });
  const today = tradingDayStr();
  // A catering / event payment goes to its job (133): sales by cash or bank,
  // owed worked out on the job.
  if (cat.home === "job") {
    const date = DATE_RE.test(String(body?.date ?? "")) ? String(body.date) : today;
    let jobId = Number(body?.job_id);
    // "+ New catering / event" on the link: create the job, then this is its first payment.
    if (body?.new_job) {
      const job = parseJob(body.new_job);
      if ("error" in job) return NextResponse.json({ error: job.error, field: "new_job" }, { status: 400 });
      if (amount > job.total) return NextResponse.json({ error: "The amount paid can't be more than the job's total.", field: "amount" }, { status: 400 });
      const { data: created, error } = await bizDb(who.businessId).from("catering_jobs").insert({ ...job, created_by: who.staff.id }).select("id").single();
      if (error || !created) return NextResponse.json({ error: "Couldn't save the job. Please try again." }, { status: 500 });
      jobId = created.id;
    }
    const res = await addJobPayment(who.businessId, jobId, who.staff.id, { amount, method, date, note: reason, place }, "link");
    if ("error" in res) {
      // A job made just now for this payment goes too, so nothing is left half-saved.
      if (body?.new_job) await bizDb(who.businessId).from("catering_jobs").delete().eq("id", jobId);
      return NextResponse.json({ error: res.error, field: "job_id" }, { status: res.status ?? 400 });
    }
    return NextResponse.json({ ok: true });
  }
  const date = DATE_RE.test(String(body?.date ?? "")) ? String(body.date) : today;
  if (date > today || date < addDays(today, -31)) return NextResponse.json({ error: "Pick today or a day in the last month." }, { status: 400 });

  const db = bizDb(who.businessId);
  // Whose wages / advance, or which supplier — this business's only.
  let staffMemberId: number | null = null;
  let supplierId: number | null = null;
  let pickedName = "";
  if (cat.pick === "staff") {
    const s = (await payableStaff(who.businessId)).find((x) => x.id === Number(body?.staff_member_id));
    if (!s) return NextResponse.json({ error: "Choose the staff member.", field: "staff_member_id" }, { status: 400 });
    staffMemberId = s.id; pickedName = s.name;
  } else if (cat.pick === "supplier") {
    const { data: s } = await db.from("suppliers").select("id, name").eq("id", Number(body?.supplier_id)).maybeSingle();
    if (!s) return NextResponse.json({ error: "Choose the supplier.", field: "supplier_id" }, { status: 400 });
    supplierId = s.id; pickedName = s.name;
  }

  // Same category + amount (+ person / supplier) the same day: ask first.
  if (body?.confirm_duplicate !== true) {
    let q = db.from("cash_movements").select("staff_id, created_at").eq("category", cat.key).eq("movement_date", date).eq("amount", amount);
    if (staffMemberId) q = q.eq("staff_member_id", staffMemberId);
    if (supplierId) q = q.eq("supplier_id", supplierId);
    const { data: same } = await q.limit(1);
    let found: string | null = null;
    if (same?.length) {
      const { data: by } = await supabase.from("staff").select("name").eq("id", same[0].staff_id ?? 0).maybeSingle();
      const at = new Date(same[0].created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
      found = `${by?.name ?? "Someone"} already entered this at ${at}`;
    } else if (cat.home === "expense") {
      const { data: exp } = await db.from("expenses").select("id").eq("category", cat.expenseCategory!).eq("expense_date", date).eq("amount", amount).limit(1);
      if (exp?.length) found = "This is already recorded as an expense that day";
    } else if (cat.home === "supplier") {
      const { start, end } = londonDayRangeUtc(date);
      const { data: pay } = await db.from("supplier_payments").select("id").eq("supplier_id", supplierId!).eq("amount", amount).gte("paid_at", start).lte("paid_at", end).limit(1);
      if (pay?.length) found = `A payment of this amount to ${pickedName} is already recorded that day`;
    }
    if (found) return NextResponse.json({ error: `${found}. If this is a different one, press Save again.`, duplicate: true }, { status: 409 });
  }

  const photos = cat.direction === "out" && cat.photo
    ? await checkReceiptsForSave(db, body?.photo_ids)
    : Array.isArray(body?.photo_ids) && body.photo_ids.length ? await checkReceiptsForSave(db, body.photo_ids) : null;
  if (photos && !photos.ok) return NextResponse.json({ error: photos.error }, { status: photos.status });

  // Its one home.
  let expenseId: number | null = null;
  let supplierPaymentId: number | null = null;
  let photoEntity: ReceiptEntity = "cash_movement";
  if (cat.home === "expense") {
    const { data: e, error } = await db.from("expenses").insert({
      category: cat.expenseCategory,
      description: [cat.label, reason, paidTo && `paid to ${paidTo}`].filter(Boolean).join(" · ").slice(0, 300),
      amount, vat_applicable: body?.vat === true ? 1 : 0, expense_date: date,
      receipt_reference: `Paid by ${payMethodLabel(method).toLowerCase()} (staff link)`, recorded_by: who.staff.id,
    }).select("id").single();
    if (error || !e) return NextResponse.json({ error: "Couldn't save. Please try again." }, { status: 500 });
    expenseId = e.id;
    photoEntity = "expense";
  } else if (cat.home === "supplier") {
    const { data: p, error } = await db.from("supplier_payments").insert({
      supplier_id: supplierId, amount, method: method === "bank" ? "bank_transfer" : method, recorded_by: who.staff.id,
      paid_at: date === today ? new Date().toISOString() : `${date}T12:00:00Z`,
      notes: [`Paid by ${payMethodLabel(method).toLowerCase()} (staff link)`, reason].filter(Boolean).join(" · "),
    }).select("id").single();
    if (error || !p) return NextResponse.json({ error: "Couldn't save. Please try again." }, { status: 500 });
    supplierPaymentId = p.id;
    photoEntity = "supplier_payment";
  }

  const { data: saved, error } = await db.from("cash_movements").insert({
    movement_date: date, direction: cat.direction, category: cat.key, amount, method, place,
    reason: reason || cat.label, paid_to: paidTo ?? (pickedName || null), staff_id: who.staff.id, source: "link",
    staff_member_id: staffMemberId, supplier_id: supplierId, expense_id: expenseId, supplier_payment_id: supplierPaymentId,
  }).select("id").single();
  if (error || !saved) {
    if (expenseId) await db.from("expenses").delete().eq("id", expenseId);
    if (supplierPaymentId) await db.from("supplier_payments").delete().eq("id", supplierPaymentId);
    return NextResponse.json({ error: "Couldn't save. Please try again." }, { status: 500 });
  }
  if (cat.home === "advance") {
    await db.from("staff_advances").insert({
      staff_id: staffMemberId, kind: cat.direction === "out" ? "advance" : "repaid", amount, advance_date: date,
      cash_movement_id: saved.id, note: reason || null, created_by: who.staff.id,
    });
  }
  if (photos?.ok) await attachReceipts(db, photos.ids, photoEntity, expenseId ?? supplierPaymentId ?? saved.id);
  return NextResponse.json({ ok: true });
}
