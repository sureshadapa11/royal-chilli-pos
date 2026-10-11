import { isFullyPaid } from "@/lib/payment-status";
// Z report (end-of-day) for one till shift (work_periods row). Payment-based,
// like SumUp's Z report: a sale belongs to the shift the money was TAKEN in,
// not the shift the order was placed in — so Card + Cash (+ Online) always
// equals Total sales, and a Pay Later bill settled in a later shift counts as
// a sale on the day it's paid instead of on no Z report at all.
//
// Pure calculation + formatting (safe to import in the browser). Loading from
// the database and the close-time snapshot live in lib/z-report-db.ts.

export type ZReport = {
  period_id: number;
  status: "open" | "closed";
  opened_at: string;
  opened_by_name: string | null;
  closed_at: string | null;
  closed_by_name: string | null;
  close_note: string | null;

  sales_count: number;
  sales_total: number; // incl. taxes, tips and discounts
  refunds_count: number;
  refunds_total: number; // positive number
  net_sales: number; // sales_total − tips − refunds: tips belong to staff, not sales

  discount_count: number;
  discount_total: number; // positive number
  // Loyalty rewards (voucher codes / points) — their own line, not a staff discount.
  loyalty_count?: number;
  loyalty_total?: number; // positive number

  tips_total: number;

  payments: { card: number; cash: number; online: number };

  cash: {
    opening: number;
    cash_in: number;
    cash_out: number;
    expected: number;
    counted: number | null;
    difference: number | null;
  };

  other: {
    // Pay Later bills from this shift still (partly) unpaid.
    pending_bills: { order_number: string; customer_name: string | null; balance: number }[];
    // Orders from an earlier shift paid off during this one — already inside
    // Total sales above, listed so the owner can see why the day looks high.
    earlier_bills_paid: { order_number: string; order_date: string | null; amount: number }[];
    paid_outs: { reason: string; amount: number }[];
    refunds: { order_number: string; method: string; amount: number }[];
    // Neither paid, cancelled nor Pay Later — blocks Close Day (open shift only).
    unresolved: { order_number: string; balance: number }[];
  };
};

export type ZPeriod = {
  id: number;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number | string | null;
  closing_cash: number | string | null;
  close_note: string | null;
};
export type ZPayment = { order_id: number; method: string; amount: number | string; tip_amount: number | string | null };
export type ZOrder = {
  id: number;
  order_number: string;
  work_period_id: number | null;
  status: string;
  pay_later: boolean | null;
  total: number | string;
  amount_paid: number | string;
  discount: number | string | null;
  loyalty_discount?: number | string | null;
  customer_name: string | null;
  created_at: string | null;
};
export type ZPaidOut = { reason: string; amount: number | string };

const r2 = (n: number) => Math.round(n * 100) / 100;

// Pure — everything the report needs is passed in, so it's unit-testable.
// `payments` = every payment taken during the shift; `orders` = the shift's
// own orders plus any order those payments belong to.
export function computeZReport(input: {
  period: ZPeriod;
  openedByName: string | null;
  closedByName: string | null;
  payments: ZPayment[];
  orders: ZOrder[];
  paidOuts: ZPaidOut[];
}): ZReport {
  const { period, payments, orders, paidOuts } = input;
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const sales = payments.filter((p) => Number(p.amount) > 0);
  const refunds = payments.filter((p) => Number(p.amount) < 0);
  const gross = (p: ZPayment) => Number(p.amount) + Number(p.tip_amount || 0);

  // A bill closed at £0 (a reward, points or a 100% discount covered it) has
  // no payment, but it's still a sale of this shift and its reward/discount
  // belongs on the report.
  const zeroBills = orders.filter((o) => o.work_period_id === period.id && o.status === "paid" && Number(o.total) <= 0.009).map((o) => o.id);
  const salesOrderIds = new Set([...sales.map((p) => p.order_id), ...zeroBills]);
  const salesTotal = sales.reduce((s, p) => s + gross(p), 0);
  const refundsTotal = refunds.reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
  const tipsTotal = sales.reduce((s, p) => s + Number(p.tip_amount || 0), 0);

  let discountCount = 0;
  let discountTotal = 0;
  let loyaltyCount = 0;
  let loyaltyTotal = 0;
  for (const id of salesOrderIds) {
    const d = Number(orderById.get(id)?.discount || 0);
    if (d > 0) {
      discountCount += 1;
      discountTotal += d;
    }
    const l = Number(orderById.get(id)?.loyalty_discount || 0);
    if (l > 0) {
      loyaltyCount += 1;
      loyaltyTotal += l;
    }
  }

  const byMethod = { card: 0, cash: 0, online: 0 };
  for (const p of sales) {
    if (p.method === "cash") byMethod.cash += gross(p);
    else if (p.method === "card_online") byMethod.online += gross(p);
    else byMethod.card += gross(p);
  }

  const paidOutTotal = paidOuts.reduce((s, p) => s + Number(p.amount), 0);
  const cashRefunds = refunds.filter((p) => p.method === "cash").reduce((s, p) => s + Math.abs(Number(p.amount)), 0);
  const opening = Number(period.opening_cash || 0);
  const cashIn = byMethod.cash;
  const cashOut = paidOutTotal + cashRefunds;
  const expected = opening + cashIn - cashOut;
  const counted = period.status === "closed" && period.closing_cash != null ? Number(period.closing_cash) : null;

  const ownOrders = orders.filter((o) => o.work_period_id === period.id);
  // Settled = nothing owed: cancelled, fully paid by money received (an
  // online-paid order stays "ready" in the kitchen — status alone isn't
  // enough), or refunded. Only unsettled orders are Pending / block Close Day.
  const refundedIds = new Set(refunds.map((p) => p.order_id));
  const settled = (o: ZOrder) => o.status === "cancelled" || isFullyPaid(o) || refundedIds.has(o.id);
  const earlier = new Map<number, number>();
  for (const p of sales) {
    const o = orderById.get(p.order_id);
    if (o && o.work_period_id !== period.id) earlier.set(p.order_id, (earlier.get(p.order_id) ?? 0) + gross(p));
  }

  return {
    period_id: period.id,
    status: period.status === "closed" ? "closed" : "open",
    opened_at: period.opened_at,
    opened_by_name: input.openedByName,
    closed_at: period.closed_at,
    closed_by_name: input.closedByName,
    close_note: period.close_note,

    sales_count: salesOrderIds.size,
    sales_total: r2(salesTotal),
    refunds_count: refunds.length,
    refunds_total: r2(refundsTotal),
    net_sales: r2(salesTotal - tipsTotal - refundsTotal),

    discount_count: discountCount,
    discount_total: r2(discountTotal),
    loyalty_count: loyaltyCount,
    loyalty_total: r2(loyaltyTotal),

    tips_total: r2(tipsTotal),

    payments: { card: r2(byMethod.card), cash: r2(byMethod.cash), online: r2(byMethod.online) },

    cash: {
      opening: r2(opening),
      cash_in: r2(cashIn),
      cash_out: r2(cashOut),
      expected: r2(expected),
      counted: counted == null ? null : r2(counted),
      difference: counted == null ? null : r2(counted - expected),
    },

    other: {
      pending_bills: ownOrders
        .filter((o) => o.pay_later && !settled(o))
        .map((o) => ({ order_number: o.order_number, customer_name: o.customer_name, balance: r2(Number(o.total) - Number(o.amount_paid)) })),
      earlier_bills_paid: [...earlier].map(([id, amount]) => ({
        order_number: orderById.get(id)?.order_number ?? `#${id}`,
        order_date: orderById.get(id)?.created_at ?? null,
        amount: r2(amount),
      })),
      paid_outs: paidOuts.map((p) => ({ reason: p.reason, amount: r2(Number(p.amount)) })),
      refunds: refunds.map((p) => ({
        order_number: orderById.get(p.order_id)?.order_number ?? `#${p.order_id}`,
        method: p.method,
        amount: r2(Math.abs(Number(p.amount))),
      })),
      unresolved:
        period.status === "closed"
          ? []
          : ownOrders
              .filter((o) => !o.pay_later && !settled(o))
              .map((o) => ({ order_number: o.order_number, balance: r2(Number(o.total) - Number(o.amount_paid)) })),
    },
  };
}

// ---------- shared formatting (screen + printer) ----------

export function zMoney(n: number): string {
  return `${n < 0 ? "-" : ""}£${Math.abs(n).toFixed(2)}`;
}

// "07 Sept 2026 13:22", restaurant-local (Vercel runs in UTC).
export function zDateTime(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date} ${time}`;
}

export type ZLine =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "row"; label: string; value: string; bold?: boolean }
  | { kind: "text"; text: string; muted?: boolean }
  | { kind: "divider" }
  | { kind: "gap" };

// The report as a list of lines in the template's order — rendered on screen
// by components/pos/ZReportView.tsx and on paper by lib/cloudprnt.ts, so the
// two can never drift apart. `counted` overrides the saved count (the End of
// Day screen shows the figure being typed in, before closing).
export function zReportLines(r: ZReport, counted: number | null = r.cash.counted): ZLine[] {
  const difference = counted == null ? null : r2(counted - r.cash.expected);
  const L: ZLine[] = [];
  L.push({ kind: "title", text: r.status === "closed" ? `Z Report ${r.period_id}` : `X Report ${r.period_id} (not closed)` });
  L.push({ kind: "gap" });
  L.push({ kind: "row", label: "Opened", value: zDateTime(r.opened_at) });
  L.push({ kind: "text", text: `By ${r.opened_by_name ?? "-"}` });
  L.push({ kind: "gap" });
  L.push({ kind: "row", label: "Closed", value: r.closed_at ? zDateTime(r.closed_at) : "Not closed yet" });
  if (r.closed_at) L.push({ kind: "text", text: `By ${r.closed_by_name ?? "-"}` });
  L.push({ kind: "divider" }, { kind: "divider" }, { kind: "gap" });

  L.push({ kind: "heading", text: "Sales and refunds" });
  L.push({ kind: "row", label: "Number of sales", value: String(r.sales_count) });
  L.push({ kind: "row", label: "Total sales amount", value: zMoney(r.sales_total) });
  L.push({ kind: "text", text: "Incl. taxes, tips and discounts", muted: true });
  L.push({ kind: "gap" });
  L.push({ kind: "row", label: "Number of refunds", value: String(r.refunds_count) });
  L.push({ kind: "row", label: "Total refunds amount", value: zMoney(r.refunds_total) });
  L.push({ kind: "row", label: "Tips (staff's, not sales)", value: zMoney(-r.tips_total) });
  L.push({ kind: "divider" });
  L.push({ kind: "row", label: "Total net sales", value: zMoney(r.net_sales), bold: true });
  L.push({ kind: "text", text: "Incl. taxes and discounts, tips not included", muted: true });
  L.push({ kind: "gap" });

  L.push({ kind: "heading", text: "Discounts" });
  L.push({ kind: "row", label: "Number of discounts", value: String(r.discount_count) });
  L.push({ kind: "row", label: "Total discount amount", value: zMoney(-r.discount_total) });
  L.push({ kind: "gap" });

  // Older saved reports (before loyalty had its own line) have no loyalty figures.
  if (r.loyalty_count) {
    L.push({ kind: "heading", text: "Loyalty" });
    L.push({ kind: "row", label: "Number of loyalty rewards", value: String(r.loyalty_count) });
    L.push({ kind: "row", label: "Total loyalty amount", value: zMoney(-(r.loyalty_total ?? 0)) });
    L.push({ kind: "gap" });
  }

  L.push({ kind: "heading", text: "Tips" });
  L.push({ kind: "row", label: "Total tips", value: zMoney(r.tips_total) });
  L.push({ kind: "gap" });

  L.push({ kind: "heading", text: "Payments" });
  L.push({ kind: "row", label: "Card", value: zMoney(r.payments.card) });
  L.push({ kind: "row", label: "Cash", value: zMoney(r.payments.cash) });
  if (r.payments.online > 0) L.push({ kind: "row", label: "Online", value: zMoney(r.payments.online) });
  L.push({ kind: "gap" });

  L.push({ kind: "heading", text: "Cash activities" });
  L.push({ kind: "row", label: "Opening cash balance", value: zMoney(r.cash.opening) });
  L.push({ kind: "row", label: "Total cash in", value: zMoney(r.cash.cash_in) });
  L.push({ kind: "row", label: "Total cash out", value: zMoney(r.cash.cash_out) });
  L.push({ kind: "row", label: "Expected closing cash balance", value: zMoney(r.cash.expected) });
  L.push({ kind: "row", label: "Counted closing cash balance", value: counted == null ? "-" : zMoney(counted) });
  L.push({ kind: "row", label: "Difference", value: difference == null ? "-" : zMoney(difference), bold: true });

  if (r.close_note) {
    L.push({ kind: "gap" });
    L.push({ kind: "heading", text: "Comment" });
    L.push({ kind: "text", text: r.close_note });
  }

  const o = r.other;
  if (o.pending_bills.length || o.earlier_bills_paid.length || o.paid_outs.length || o.refunds.length || o.unresolved.length) {
    L.push({ kind: "gap" }, { kind: "divider" });
    L.push({ kind: "heading", text: "Other" });
    if (o.unresolved.length) {
      L.push({ kind: "text", text: "UNRESOLVED - pay or mark Pay Later" });
      for (const u of o.unresolved) L.push({ kind: "row", label: `  ${u.order_number}`, value: zMoney(u.balance) });
    }
    if (o.pending_bills.length) {
      L.push({ kind: "text", text: "Pay Later bills still unpaid" });
      for (const b of o.pending_bills) L.push({ kind: "row", label: `  ${b.order_number}${b.customer_name ? ` ${b.customer_name}` : ""}`, value: zMoney(b.balance) });
    }
    if (o.earlier_bills_paid.length) {
      L.push({ kind: "text", text: "Earlier bills paid this shift (in sales)" });
      for (const b of o.earlier_bills_paid) {
        const day = b.order_date ? ` (${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short" }).format(new Date(b.order_date))})` : "";
        L.push({ kind: "row", label: `  ${b.order_number}${day}`, value: zMoney(b.amount) });
      }
    }
    if (o.paid_outs.length) {
      L.push({ kind: "text", text: "Cash paid out" });
      for (const p of o.paid_outs) L.push({ kind: "row", label: `  ${p.reason}`, value: zMoney(p.amount) });
    }
    if (o.refunds.length) {
      L.push({ kind: "text", text: "Refunds" });
      for (const f of o.refunds) L.push({ kind: "row", label: `  ${f.order_number} (${f.method === "cash" ? "cash" : f.method === "card_online" ? "online" : "card"})`, value: zMoney(f.amount) });
    }
  }
  return L;
}
