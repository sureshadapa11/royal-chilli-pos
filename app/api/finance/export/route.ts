import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageFinance } from "@/lib/permissions";
import { allRows } from "@/lib/finance";
import { moneyOutForMonth } from "@/lib/money-out";
import { tradingDayStr, tradingRangeUtc } from "@/lib/london-date";
import type { ZReport } from "@/lib/z-report";

// GET /api/finance/export?month=YYYY-MM — one Excel file for the accountant:
// Daily summary (trading days, 5am-5am UK), Payments, Refunds, Z reports, and
// Money out (with the file names of its receipt photos in the receipts zip).
// Money is counted when it was taken (payments), matching the Z report.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageFinance(session.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = bizDb(session.businessId);

  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month=YYYY-MM is required" }, { status: 400 });
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(lastDay).padStart(2, "0")}`;
  const { start, end } = tradingRangeUtc(from, to);

  type PayRow = { order_id: number; method: string; amount: number; tip_amount: number | null; reference: string | null; created_at: string; orders: unknown };
  type OrderRow = { id: number; created_at: string; tax: number; discount: number | null; loyalty_discount: number | null };
  const [payments, orders, { data: periods }, moneyOut] = await Promise.all([
    allRows<PayRow>((a, b) => db.from("payments").select("order_id, method, amount, tip_amount, reference, created_at, orders(order_number, total, tax)")
      .gte("created_at", start).lte("created_at", end).order("created_at").order("id").range(a, b)),
    allRows<OrderRow>((a, b) => db.from("orders").select("id, created_at, tax, discount, loyalty_discount").eq("is_paid", true)
      .gte("created_at", start).lte("created_at", end).order("id").range(a, b)),
    db.from("work_periods").select("id, opened_at, closed_at, close_note, z_report").eq("status", "closed").gte("closed_at", start).lte("closed_at", end).order("closed_at"),
    moneyOutForMonth(db, month),
  ]);

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const uk = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London" });
  const METHOD: Record<string, string> = { cash: "Cash", card: "Card", card_online: "Online" };

  // Daily summary, one row per trading day of the month.
  type Day = { sales: number; card: number; cash: number; online: number; tips: number; refunds: number; vat: number; discounts: number; loyalty: number; orders: number };
  const days = new Map<string, Day>();
  for (let d = 1; d <= lastDay; d++) days.set(`${month}-${String(d).padStart(2, "0")}`, { sales: 0, card: 0, cash: 0, online: 0, tips: 0, refunds: 0, vat: 0, discounts: 0, loyalty: 0, orders: 0 });
  for (const p of payments) {
    const day = days.get(tradingDayStr(new Date(p.created_at)));
    if (!day) continue;
    const amount = Number(p.amount);
    const tip = Number(p.tip_amount || 0);
    if (amount < 0) {
      // Refunds give back VAT in the same proportion as the bill (as in the P&L).
      const o = p.orders as { total: number; tax: number } | null;
      day.refunds += -amount;
      if (o && Number(o.total) > 0) day.vat -= -amount * (Number(o.tax) / Number(o.total));
      continue;
    }
    day.sales += amount + tip;
    day.tips += tip;
    if (p.method === "cash") day.cash += amount + tip;
    else if (p.method === "card_online") day.online += amount + tip;
    else day.card += amount + tip;
  }
  for (const o of orders) {
    const day = days.get(tradingDayStr(new Date(o.created_at)));
    if (!day) continue;
    day.orders += 1;
    day.vat += Number(o.tax || 0);
    day.discounts += Number(o.discount || 0);
    day.loyalty += Number(o.loyalty_discount || 0);
  }
  const daily = [...days].map(([date, d]) => ({
    "Trading day": date,
    "Paid orders": d.orders,
    "Sales taken (incl. tips)": r2(d.sales),
    Card: r2(d.card),
    Cash: r2(d.cash),
    Online: r2(d.online),
    Tips: r2(d.tips),
    Refunds: r2(d.refunds),
    "Net taken": r2(d.sales - d.refunds),
    "VAT (paid orders less refunds)": r2(d.vat),
    Discounts: r2(d.discounts),
    Loyalty: r2(d.loyalty),
  }));
  const totals = daily.reduce<Record<string, number | string>>((acc, row) => {
    for (const [k, v] of Object.entries(row)) if (typeof v === "number") acc[k] = r2(Number(acc[k] ?? 0) + v);
    return acc;
  }, { "Trading day": "TOTAL" });
  daily.push(totals as (typeof daily)[number]);

  const orderNo = (p: { orders: unknown }) => (p.orders as { order_number: string } | null)?.order_number ?? "";
  const paymentRows = payments.filter((p) => Number(p.amount) > 0).map((p) => ({
    "Date/time (UK)": uk(p.created_at), "Trading day": tradingDayStr(new Date(p.created_at)), Order: orderNo(p),
    Method: METHOD[p.method] ?? p.method, Amount: r2(Number(p.amount)), Tip: r2(Number(p.tip_amount || 0)), Reference: p.reference ?? "",
  }));
  const refundRows = payments.filter((p) => Number(p.amount) < 0).map((p) => ({
    "Date/time (UK)": uk(p.created_at), "Trading day": tradingDayStr(new Date(p.created_at)), Order: orderNo(p),
    Method: METHOD[p.method] ?? p.method, Amount: r2(-Number(p.amount)), Reason: p.reference ?? "",
  }));
  const zRows = (periods ?? []).map((p) => {
    const z = p.z_report as ZReport | null;
    return {
      "Z report": p.id, Opened: uk(p.opened_at), Closed: p.closed_at ? uk(p.closed_at) : "",
      "Total sales": z?.sales_total ?? "", Refunds: z?.refunds_total ?? "", "Net sales": z?.net_sales ?? "",
      Card: z?.payments.card ?? "", Cash: z?.payments.cash ?? "", Online: z?.payments.online ?? "", Tips: z?.tips_total ?? "",
      "Expected cash": z?.cash.expected ?? "", "Counted cash": z?.cash.counted ?? "", "Cash difference": z?.cash.difference ?? "",
      Comment: p.close_note ?? "",
    };
  });

  const moneyOutRows = moneyOut.map((r) => ({
    Date: r.date, Type: r.type, "Paid to": r.paidTo, Details: r.details, Amount: r2(r.amount),
    Check: r.photos.length === 0 ? "No photo" : "",
    "Receipt photos (in receipts zip)": r.photos.map((p) => p.fileName).join(", "),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(daily), "Daily summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentRows.length ? paymentRows : [{ Note: "No payments this month" }]), "Payments");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(refundRows.length ? refundRows : [{ Note: "No refunds this month" }]), "Refunds");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(zRows.length ? zRows : [{ Note: "No closed till shifts this month" }]), "Z reports");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(moneyOutRows.length ? moneyOutRows : [{ Note: "Nothing paid out this month" }]), "Money out");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="royal-chilli-accounts-${month}.xlsx"`,
    },
  });
}
