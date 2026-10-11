import { bizDb } from "@/lib/business-db";
import { tradingDayStr, tradingRangeUtc } from "@/lib/london-date";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type DiscountType = "percent" | "amount" | null;

export interface BillInput {
  subtotal: number;
  discountType: DiscountType;
  discountPct: number | null;
  // The order's stored `discount` column. Used as-is (clamped only) when
  // discountType isn't "percent" — it's the raw flat amount staff chose, and
  // must never be silently overwritten by a clamp (e.g. items voided,
  // subtotal shrinks below it) or the original intent is lost for good.
  discountAmount: number;
  serviceChargePct: number;
  // A loyalty reward (voucher code or points) — its own line, taken off
  // after the staff discount; both can apply to the same bill.
  loyaltyAmount?: number;
}

export interface BillBreakdown {
  subtotal: number;
  tax: number;
  subtotalWithTax: number;
  discount: number;
  loyalty: number;
  /** Food after discount and loyalty — what VAT is charged on. */
  discounted: number;
  serviceChargeAmount: number;
  total: number;
}

// The single place bill math happens — subtotal -> discount -> loyalty ->
// service charge -> total. Tip is deliberately not here: it's per-payment,
// never part of the bill total (see PaymentModal.tsx / payments.tip_amount).
//
// Menu/item prices are VAT-INCLUSIVE — the number a customer sees (till or
// online) is exactly what they pay, standard for a UK consumer-facing menu.
// `subtotal` therefore already includes VAT; there is no additive VAT step.
// `tax` is reported for receipts/VAT-return purposes only — the 20% VAT
// component *embedded in* the food after discount and loyalty. Service charge
// (and tip) carry no VAT, so they're never part of it.
export function computeBill(input: BillInput): BillBreakdown {
  const subtotal = round2(input.subtotal);

  let discount = 0;
  if (input.discountType === "percent" && input.discountPct != null) {
    discount = round2(subtotal * (input.discountPct / 100));
  } else {
    discount = round2(input.discountAmount || 0);
  }
  discount = Math.max(0, Math.min(discount, subtotal));
  const loyalty = Math.max(0, Math.min(round2(input.loyaltyAmount || 0), round2(subtotal - discount)));

  const discounted = round2(subtotal - discount - loyalty);
  const serviceChargeAmount = round2(discounted * (input.serviceChargePct / 100));
  const total = round2(discounted + serviceChargeAmount);
  const tax = round2(discounted - discounted / 1.2);

  // subtotalWithTax kept for shape-compatibility with existing callers —
  // there's no separate "with tax" figure any more since subtotal already
  // includes it, so this is just subtotal itself.
  return { subtotal, tax, subtotalWithTax: subtotal, discount, loyalty, discounted, serviceChargeAmount, total };
}

/**
 * Splits a whole-bill amount across a table's rounds in proportion to each
 * round's food, to the penny: the rounding pennies go to the biggest round,
 * so the shares always add up to exactly `amount`. No food at all → the
 * first round takes it.
 */
export function splitByFood(amount: number, foods: number[]): number[] {
  if (foods.length === 0) return [];
  const food = foods.reduce((s, f) => s + Math.max(0, f), 0);
  const shares = foods.map((f) => (food > 0 ? round2((amount * Math.max(0, f)) / food) : 0));
  const big = food > 0 ? foods.indexOf(Math.max(...foods)) : 0;
  shares[big] = round2(shares[big] + round2(amount - shares.reduce((s, x) => s + x, 0)));
  return shares;
}

type RoundRow = {
  id: number; created_at: string; discount: number | null; discount_type: string | null; discount_pct: number | null;
  service_charge_pct: number | null; loyalty_discount: number | null;
};

/**
 * A dine-in table's bill: every "Send to Kitchen" is its own order (a round,
 * see lib/kitchen-rounds.ts), but the guests get ONE bill. Its rounds are the
 * table's unpaid, live orders this trading day — the same ones the kitchen
 * counts — oldest first. The oldest holds the bill's discount, loyalty
 * reward and service charge. Empty when the order isn't part of a table bill
 * with more than one round.
 */
async function tableBillRounds(
  db: ReturnType<typeof bizDb>,
  order: { order_type?: string | null; table_id?: number | null; status?: string | null; is_paid?: boolean | null } | null,
): Promise<RoundRow[]> {
  if (!order || order.order_type !== "dine_in" || !order.table_id || order.is_paid || order.status === "paid" || order.status === "cancelled") return [];
  const { start } = tradingRangeUtc(tradingDayStr());
  const { data } = await db.from("orders")
    .select("id, created_at, discount, discount_type, discount_pct, service_charge_pct, loyalty_discount")
    .eq("table_id", order.table_id).eq("order_type", "dine_in").eq("is_paid", false)
    .not("status", "in", '("paid","cancelled")').gte("created_at", start);
  const rounds = ((data ?? []) as RoundRow[]).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  return rounds.length > 1 ? rounds : [];
}

/**
 * The table bill an order belongs to: its rounds' ids, oldest (the one that
 * holds the bill's adjustments) first. Just the order itself when it isn't
 * part of a table bill with several rounds.
 */
export async function tableBillOrderIds(orderId: number, businessId: number): Promise<number[]> {
  const db = bizDb(businessId);
  const { data: order } = await db.from("orders").select("order_type, table_id, status, is_paid").eq("id", orderId).maybeSingle();
  const rounds = await tableBillRounds(db, order);
  return rounds.length && rounds.some((r) => r.id === orderId) ? rounds.map((r) => r.id) : [orderId];
}

/**
 * Recalculates an order's bill and saves it. For a table bill with several
 * rounds, the WHOLE bill is worked out (all rounds' food, with the oldest
 * round's discount / loyalty / service charge) and its total, VAT and service
 * charge are split across the rounds by their food, so each round's total is
 * its share and they add up to the bill. Returns the whole bill.
 */
export async function recalcTotals(orderId: string, businessId: number) {
  const db = bizDb(businessId);
  const { data: orderData } = await db
    .from("orders")
    .select("discount, discount_type, discount_pct, service_charge_pct, loyalty_discount, order_type, table_id, status, is_paid")
    .eq("id", orderId)
    .single();

  const rounds = await tableBillRounds(db, orderData);
  if (rounds.some((r) => String(r.id) === String(orderId))) return recalcTableBill(db, rounds);

  // Sum only active (non-cancelled) items
  const { data: activeItems } = await db
    .from("order_items")
    .select("item_price, quantity")
    .eq("order_id", orderId)
    .neq("status", "cancelled");

  const subtotal = (activeItems ?? []).reduce(
    (s: number, i: { item_price: number; quantity: number }) => s + i.item_price * i.quantity,
    0
  );

  const bill = computeBill({
    subtotal,
    discountType: (orderData?.discount_type as DiscountType) ?? null,
    discountPct: orderData?.discount_pct ?? null,
    discountAmount: orderData?.discount ?? 0,
    serviceChargePct: orderData?.service_charge_pct ?? 0,
    loyaltyAmount: Number(orderData?.loyalty_discount ?? 0),
  });

  const updatePayload: Record<string, unknown> = {
    subtotal: bill.subtotal,
    tax: bill.tax,
    service_charge_amount: bill.serviceChargeAmount,
    total: bill.total,
    updated_at: new Date().toISOString(),
  };
  // Only refresh the stored `discount` for percent-type discounts, where
  // it's purely a derived display cache. For a flat-amount discount, leave
  // it exactly as staff set it — the clamp above only affects this bill's
  // total, never the stored rule.
  if (orderData?.discount_type === "percent") {
    updatePayload.discount = bill.discount;
  }

  await db.from("orders").update(updatePayload).eq("id", orderId);
  return bill;
}

async function recalcTableBill(db: ReturnType<typeof bizDb>, rounds: RoundRow[]) {
  const ids = rounds.map((r) => r.id);
  const { data: items } = await db.from("order_items").select("order_id, item_price, quantity").in("order_id", ids).neq("status", "cancelled");
  const foods = ids.map((id) => round2((items ?? []).filter((i) => i.order_id === id).reduce((s, i) => s + Number(i.item_price) * Number(i.quantity), 0)));
  const lead = rounds[0];
  const bill = computeBill({
    subtotal: foods.reduce((s, f) => s + f, 0),
    discountType: (lead.discount_type as DiscountType) ?? null,
    discountPct: lead.discount_pct ?? null,
    discountAmount: Number(lead.discount ?? 0),
    serviceChargePct: Number(lead.service_charge_pct ?? 0),
    loyaltyAmount: rounds.reduce((s, r) => s + Number(r.loyalty_discount ?? 0), 0),
  });
  const totals = splitByFood(bill.total, foods);
  const taxes = splitByFood(bill.tax, foods);
  const service = splitByFood(bill.serviceChargeAmount, foods);
  const now = new Date().toISOString();
  await Promise.all(rounds.map((r, i) => {
    const payload: Record<string, unknown> = { subtotal: foods[i], tax: taxes[i], service_charge_amount: service[i], total: totals[i], updated_at: now };
    if (i === 0 && lead.discount_type === "percent") payload.discount = bill.discount;
    return db.from("orders").update(payload).eq("id", r.id);
  }));
  return bill;
}
