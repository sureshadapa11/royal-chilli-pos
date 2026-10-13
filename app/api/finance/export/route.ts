import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageFinance } from "@/lib/permissions";
import { allRows } from "@/lib/finance";
import { moneyOutForMonth } from "@/lib/money-out";
import { tradingDayStr, tradingRangeUtc } from "@/lib/london-date";
import type { ZReport } from "@/lib/z-report";
import { tillInUse } from "@/lib/till-in-use";
import { accountsByDay } from "@/lib/daily-figures";
import { getVatRate, extractVat } from "@/lib/finance";
import { cashBook } from "@/lib/cash-book";
import { salarySheet } from "@/lib/salary-sheet";
import { cashCategoryLabel, payMethodLabel } from "@/lib/cash-categories";
import { getBrand } from "@/lib/brand";
import supabase from "@/lib/supabase";
import { listJobs, jobKindLabel, countsAsSales } from "@/lib/catering-jobs";

// GET /api/finance/export?month=YYYY-MM — one Excel file for the accountant
// (agreed 2026-10-12): Daily summary from Daily accounts (Day End), VAT
// summary, Cash book, Money In / Out (staff link entries), Money out (with the
// file names of its receipt photos in the receipts zip) and Salary (pay per
// person, no hours). The till's daily takings, Payments, Refunds and Z reports
// sheets are only added once the till is in use (lib/till-in-use.ts).
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

  // ── From what's entered by hand (Day End / Daily accounts, staff links) ──
  const [{ days: figDays, rows: dayRows }, vatRate, { data: vatExp }, book, { data: moves }, pay, till, brand] = await Promise.all([
    accountsByDay(session.businessId, from, to),
    getVatRate(session.businessId),
    db.from("expenses").select("amount, expense_date").eq("vat_applicable", 1).gte("expense_date", from).lte("expense_date", to),
    cashBook(session.businessId, from, to),
    db.from("cash_movements").select("movement_date, direction, category, method, amount, reason, paid_to, staff_id, created_at")
      .gte("movement_date", from).lte("movement_date", to).order("movement_date").order("created_at"),
    salarySheet(session.businessId, from, to),
    tillInUse(session.businessId),
    getBrand(session.businessId),
  ]);
  const rowBy = new Map(dayRows.map((r) => [r.trading_date, r]));
  const n = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
  const cell = (v: unknown) => (v == null || v === "" ? "" : r2(Number(v)));
  const accountsDaily: Record<string, string | number>[] = figDays.map((f) => {
    const r = rowBy.get(f.date);
    const entered = r?.status === "submitted";
    const has = entered || f.total_sales !== 0;
    return {
      "Trading day": f.date,
      "Day End": entered ? "Entered" : "No Day End",
      "Z report": cell(r?.z_report), Card: cell(r?.card), Cash: cell(r?.cash), Tips: cell(r?.tips),
      "Just Eat": cell(r?.just_eat), "Just Eat commission": cell(r?.just_eat_commission),
      Deliveroo: cell(r?.deliveroo), "Deliveroo commission": cell(r?.deliveroo_commission),
      "Uber Eats": cell(r?.uber_eats), "Uber Eats commission": cell(r?.uber_eats_commission),
      Hiest: cell(r?.hiest), "Hiest commission": cell(r?.hiest_commission),
      "Catering paid": f.sales.catering ? r2(f.sales.catering) : cell(r?.catering_paid), "Events paid": f.sales.events ? r2(f.sales.events) : "",
      "Catering pending": cell(r?.catering_pending),
      Pending: cell(r?.pending), "Bank in": cell(r?.bank_in),
      "Total sales": has ? r2(f.total_sales) : "",
      "Ex-VAT": has ? r2(f.ex_vat) : "",
      VAT: has ? r2(f.total_sales - f.ex_vat) : "",
      Notes: String(r?.notes ?? ""),
    };
  });
  const enteredCount = accountsDaily.filter((d) => d["Day End"] === "Entered").length;
  const accTotals = accountsDaily.reduce<Record<string, number | string>>((acc, row) => {
    for (const [k, v] of Object.entries(row)) if (typeof v === "number") acc[k] = r2(Number(acc[k] ?? 0) + v);
    return acc;
  }, { "Trading day": "TOTAL", "Day End": `${enteredCount} of ${accountsDaily.length} entered` });
  accountsDaily.push(accTotals);

  // VAT: the same estimate as Finance and the dashboard (sales ÷ 1.2).
  const totalSales = r2(figDays.reduce((s, f) => s + f.total_sales, 0));
  const salesVat = r2(figDays.reduce((s, f) => s + f.total_sales - f.ex_vat, 0));
  const claimed = r2((vatExp ?? []).reduce((s, e) => s + extractVat(n(e.amount), vatRate), 0));
  const vatRows: Record<string, string | number>[] = [
    { Item: "Total sales (incl. VAT)", Amount: totalSales },
    { Item: "Sales ex-VAT", Amount: r2(totalSales - salesVat) },
    { Item: `Sales VAT (${Math.round(vatRate * 100)}%)`, Amount: salesVat },
    { Item: "VAT claimed back on expenses", Amount: claimed },
    { Item: "VAT to pay", Amount: r2(salesVat - claimed) },
    { Item: "Note", Amount: "Estimate: sales divided by 1.2. Check with the accountant before filing." },
  ];

  const bookRows = book.days.map((d) => {
    const sum = (kinds: string[], f: "inAmount" | "outAmount") => r2(d.lines.filter((l) => kinds.includes(l.kind)).reduce((s, l) => s + l[f], 0));
    return {
      Date: d.date, "Day End": d.entered ? "Entered" : "No Day End",
      Opening: d.opening ?? "", "Cash sales": sum(["sales"], "inAmount"), "Money in": sum(["in"], "inAmount"),
      "Money out": sum(["out", "till_out"], "outAmount"), "Bank in": sum(["bank"], "outAmount"),
      Expected: d.expected ?? "", Counted: d.counted ?? "", Variance: d.variance ?? "",
    };
  });

  const ids = [...new Set((moves ?? []).map((m) => m.staff_id).filter(Boolean))] as number[];
  const { data: who } = ids.length ? await supabase.from("staff").select("id, name").in("id", ids) : { data: [] as { id: number; name: string }[] };
  const nameOf = (id: number | null) => (who ?? []).find((w) => w.id === id)?.name ?? "";
  const moveRows = (moves ?? []).map((m) => ({
    Date: m.movement_date, "In / Out": m.direction === "in" ? "In" : "Out", Category: cashCategoryLabel(m.category),
    "Paid how": payMethodLabel(m.method), Amount: r2(n(m.amount)), Reason: m.reason ?? "", "Paid to": m.paid_to ?? "", "Entered by": nameOf(m.staff_id),
  }));

  // Salary: pay per person only (no hours or rates), as agreed.
  const payRows: Record<string, string | number>[] = pay.filter((p) => p.wages || p.paid || p.advanceDeducted || p.balance).map((p) => ({
    Name: p.name, Pay: r2(p.wages), "Paid so far": r2(p.paid), "Advance deducted": r2(p.advanceDeducted), "Still to pay": r2(p.balance),
  }));
  if (payRows.length) {
    const t = (k: string) => r2(payRows.reduce((s, p) => s + Number(p[k]), 0));
    payRows.push({ Name: "TOTAL", Pay: t("Pay"), "Paid so far": t("Paid so far"), "Advance deducted": t("Advance deducted"), "Still to pay": t("Still to pay") });
  }

  // Catering & events (133): the month's jobs and any still owed, with payments.
  const jobs = await listJobs(session.businessId, month);
  const jobList = [...new Map([...jobs.month, ...jobs.owed].map((j) => [j.id, j])).values()];
  const jobRows = jobList.map((j) => ({
    Type: jobKindLabel(j.kind), Customer: j.customer, Date: j.date, Total: j.total, "Paid to date": j.paid,
    "Of which in sales (cash / bank)": r2(j.payments.filter((p) => countsAsSales(p.method)).reduce((s, p) => s + p.amount, 0)),
    "Card (already in Z report)": r2(j.payments.filter((p) => !countsAsSales(p.method)).reduce((s, p) => s + p.amount, 0)),
    Owed: j.owed, Status: j.cancelled ? "Cancelled" : j.owed > 0 ? "Owed" : "Paid",
    Payments: j.payments.map((p) => `${p.date} £${p.amount.toFixed(2)} ${p.method}`).join("; "),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(accountsDaily), "Daily summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vatRows), "VAT summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bookRows.length ? bookRows : [{ Note: "No cash book entries this month" }]), "Cash book");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(moveRows.length ? moveRows : [{ Note: "No Money In / Out entries this month" }]), "Money In-Out");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(moneyOutRows.length ? moneyOutRows : [{ Note: "Nothing paid out this month" }]), "Money out");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(jobRows.length ? jobRows : [{ Note: "No catering or events this month" }]), "Catering & events");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payRows.length ? payRows : [{ Note: "No pay this month" }]), "Salary");
  if (till) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(daily), "Till daily");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentRows.length ? paymentRows : [{ Note: "No payments this month" }]), "Payments");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(refundRows.length ? refundRows : [{ Note: "No refunds this month" }]), "Refunds");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(zRows.length ? zRows : [{ Note: "No closed till shifts this month" }]), "Z reports");
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-accounts-${month}.xlsx"`,
    },
  });
}
