import { NextRequest, NextResponse } from "next/server";
import { accountsAccess } from "@/lib/accounts-access";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb } from "@/lib/business-db";
import { receiptsFor } from "@/lib/receipts";
import { dayAmountKey, otherEntriesByDayAmount } from "@/lib/cash-duplicates";
import { cashCategoryLabel, payMethodLabel } from "@/lib/cash-categories";

// GET ?month=YYYY-MM — Staff Hub → Daily accounts → Cash in/out: every entry
// from the Cash In / Out link that month, with who entered it and its photos,
// plus each Day End's Z report photo.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).seeFigures) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "Pick a month" }, { status: 400 });
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const db = bizDb(session.businessId);
  const [{ data: moves }, { data: days }] = await Promise.all([
    db.from("cash_movements").select("id, movement_date, direction, category, method, amount, reason, paid_to, staff_id, created_at, expense_id, supplier_payment_id")
      .gte("movement_date", from).lte("movement_date", to).order("movement_date").order("id"),
    db.from("daily_accounts").select("id, trading_date, submitted_by, submitted_via").eq("status", "submitted")
      .gte("trading_date", from).lte("trading_date", to).order("trading_date"),
  ]);
  const ids = [...new Set([...(moves ?? []).map((x) => x.staff_id), ...(days ?? []).map((x) => x.submitted_by)].filter((x): x is number => !!x))];
  const { data: staff } = ids.length ? await supabase.from("staff").select("id, name").in("id", ids) : { data: [] as { id: number; name: string }[] };
  const nameOf = (id: number | null) => (staff ?? []).find((s) => s.id === id)?.name ?? "—";
  const list = moves ?? [];
  const [movePhotos, expPhotos, payPhotos, dayPhotos, others] = await Promise.all([
    receiptsFor(db, "cash_movement", list.map((x) => x.id)),
    receiptsFor(db, "expense", list.map((x) => x.expense_id).filter((x): x is number => !!x)),
    receiptsFor(db, "supplier_payment", list.map((x) => x.supplier_payment_id).filter((x): x is number => !!x)),
    receiptsFor(db, "daily_account", (days ?? []).map((x) => x.id)),
    otherEntriesByDayAmount(db, from, to, {
      expenseIds: new Set(list.map((x) => x.expense_id).filter((x): x is number => !!x)),
      supplierPaymentIds: new Set(list.map((x) => x.supplier_payment_id).filter((x): x is number => !!x)),
    }),
  ]);
  return NextResponse.json({
    // A cash-out with the same amount that day in the Staff Hub or on the till
    // may be the same spend entered twice (it would count twice in Money out).
    movements: list.map((x) => ({
      ...x, amount: Number(x.amount), by: nameOf(x.staff_id), categoryLabel: cashCategoryLabel(x.category), methodLabel: payMethodLabel(x.method),
      photos: (x.expense_id ? expPhotos.get(x.expense_id) : x.supplier_payment_id ? payPhotos.get(x.supplier_payment_id) : movePhotos.get(x.id)) ?? [],
      possibleDuplicate: x.direction === "out" ? others.get(dayAmountKey(x.movement_date, x.amount)) ?? null : null,
    })),
    dayEnds: (days ?? []).map((x) => ({ date: x.trading_date, by: nameOf(x.submitted_by), via: x.submitted_via, photos: dayPhotos.get(x.id) ?? [] })),
  });
}

// DELETE ?id= — a manager removes a wrong or doubled Cash In / Out entry
// (kept in the audit log, with what it was).
export async function DELETE(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !accountsAccess(session).canDelete) return NextResponse.json({ error: "Only a Super admin can delete entries" }, { status: 401 });
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Which entry?" }, { status: 400 });
  const db = bizDb(session.businessId);
  // Its one home goes with it (the expense / supplier payment it created;
  // a staff advance row is removed by the database with it).
  const { data: gone } = await db.from("cash_movements").delete().eq("id", id)
    .select("movement_date, direction, category, amount, reason, paid_to, staff_id, staff_member_id, expense_id, supplier_payment_id");
  if (!gone?.length) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  const g = gone[0];
  if (g.expense_id) {
    await db.from("receipt_photos").update({ entity_type: null, entity_id: null }).eq("entity_type", "expense").eq("entity_id", g.expense_id);
    await db.from("expenses").delete().eq("id", g.expense_id);
  }
  if (g.supplier_payment_id) {
    await db.from("receipt_photos").update({ entity_type: null, entity_id: null }).eq("entity_type", "supplier_payment").eq("entity_id", g.supplier_payment_id);
    await db.from("supplier_payments").delete().eq("id", g.supplier_payment_id);
  }
  await db.from("receipt_photos").update({ entity_type: null, entity_id: null }).eq("entity_type", "cash_movement").eq("entity_id", id);
  await db.from("audit_logs").insert({ staff_id: session.id, action: "cash_movement_deleted", entity_type: "cash_movement", entity_id: id, changes: gone[0] });
  return NextResponse.json({ ok: true });
}
