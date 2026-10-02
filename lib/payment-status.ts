// Whether an order has been paid, judged by the money received — not by
// orders.status. An order paid online (Stripe) stays "sent_to_kitchen" /
// "ready" while the kitchen works on it; only a till payment moves it to
// "paid". Checking status alone let paid online orders be cancelled without a
// refund and printed "UNPAID" receipts. Safe to import in the browser.

type Money = { status?: string | null; total: number | string; amount_paid: number | string | null };

const PENNY = 0.009;

export function isFullyPaid(order: Money): boolean {
  if (order.status === "paid") return true;
  const total = Number(order.total);
  return total > 0 && Number(order.amount_paid || 0) >= total - PENNY;
}

// A pay-online website order (orders.pay_online, or one that started a Stripe
// Checkout) whose payment hasn't landed yet — not a real order until it does,
// so it's kept off the kitchen board and staff order lists.
export function awaitingOnlinePayment(order: Money & { pay_online?: boolean | null; stripe_session_id?: string | null }): boolean {
  if (!order.pay_online && !order.stripe_session_id) return false;
  return !isFullyPaid(order);
}

// Money currently held against the order (payments minus refunds).
export function amountHeld(order: Money): number {
  const paid = Number(order.amount_paid || 0);
  return paid > PENNY ? Math.round(paid * 100) / 100 : 0;
}

// One word for the money side of an order, for History badges and receipts.
// `refunded` is the total handed back (refund rows are negative payments);
// amount_paid is already net of it. A full refund of an order that was paid
// reads "refunded", not "unpaid" — nothing is owed.
export type PaymentState = "paid" | "part_paid" | "unpaid" | "refunded" | "part_refunded";

export function paymentState(order: Money, refunded: number): PaymentState {
  const held = amountHeld(order);
  if (refunded > PENNY) return held > PENNY ? "part_refunded" : "refunded";
  if (isFullyPaid(order)) return "paid";
  return held > PENNY ? "part_paid" : "unpaid";
}

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  paid: "Paid",
  part_paid: "Part paid",
  unpaid: "Unpaid",
  refunded: "Refunded",
  part_refunded: "Part refunded",
};
