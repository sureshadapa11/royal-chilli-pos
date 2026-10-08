// Purchase order stages and who may move an order between them (inventory v2
// phase 1, migration 116). The routes ask planPoAction() what a button does;
// move_purchase_order (SQL) then makes the move safely and logs it.
//
//   draft → submit → awaiting_approval → approve → approved → mark_sent → ordered → (receive) → received
//          (at or under the limit, or a Super admin: straight to approved)
//   awaiting_approval → reject → rejected
//   draft / awaiting_approval / approved / ordered → cancel → cancelled

export const PO_STATUSES = ["draft", "awaiting_approval", "approved", "ordered", "received", "rejected", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  ordered: "Sent to supplier",
  received: "Received",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** Stages a delivery can be received in (receive_purchase_order checks the same). */
export const RECEIVABLE: PoStatus[] = ["approved", "ordered"];

/** Orders still to come — counted as "on order". */
export const OPEN_PO_STATUSES: PoStatus[] = ["draft", "awaiting_approval", "approved", "ordered"];

export const DEFAULT_APPROVAL_LIMIT = 150;
export const APPROVAL_LIMIT_KEY = "po_approval_limit";

export const PO_ACTIONS = ["submit", "approve", "reject", "mark_sent", "cancel"] as const;
export type PoAction = (typeof PO_ACTIONS)[number];

export type PoActor = {
  id: number;
  /** Super admin — may approve anything, their own orders included. */
  owner: boolean;
  /** Has the "Approve purchase orders" tick. */
  canApprove: boolean;
};

type PoForAction = { status: string; total_cost: number | string | null; created_by: number | null };

export type PoPlan =
  | { ok: true; from: PoStatus[]; to: PoStatus; event: string }
  | { ok: false; status: number; error: string };

const deny = (status: number, error: string): PoPlan => ({ ok: false, status, error });

/** Over the limit needs someone else to approve it. Exactly the limit is fine. */
export function needsApproval(total: number, limit: number): boolean {
  return Math.round(total * 100) > Math.round(limit * 100);
}

/** May this person approve this order? */
export function mayApprove(po: { created_by: number | null }, actor: PoActor): boolean {
  if (actor.owner) return true;
  return actor.canApprove && po.created_by !== actor.id;
}

export function planPoAction(po: PoForAction, action: string, actor: PoActor, limit: number, comment?: string | null): PoPlan {
  const status = po.status as PoStatus;
  const total = Number(po.total_cost) || 0;
  const wrong = () => deny(409, `This order is ${PO_STATUS_LABEL[status]?.toLowerCase() ?? status}, so it can't be ${ACTION_PAST[action as PoAction] ?? "changed"}.`);

  switch (action) {
    case "submit":
      if (status !== "draft") return wrong();
      if (!needsApproval(total, limit) || actor.owner) return { ok: true, from: ["draft"], to: "approved", event: "auto_approved" };
      return { ok: true, from: ["draft"], to: "awaiting_approval", event: "submitted" };

    case "approve":
      if (status !== "awaiting_approval") return wrong();
      if (!actor.owner && !actor.canApprove) return deny(403, "You don't have permission to approve purchase orders.");
      if (!mayApprove(po, actor)) return deny(403, "You can't approve your own order. Ask another manager or a Super admin.");
      return { ok: true, from: ["awaiting_approval"], to: "approved", event: "approved" };

    case "reject":
      if (status !== "awaiting_approval") return wrong();
      if (!actor.owner && !actor.canApprove) return deny(403, "You don't have permission to reject purchase orders.");
      if (!comment?.trim()) return deny(400, "Say why it's rejected, so the person who ordered knows what to change.");
      return { ok: true, from: ["awaiting_approval"], to: "rejected", event: "rejected" };

    case "mark_sent":
      if (status !== "approved") return wrong();
      return { ok: true, from: ["approved"], to: "ordered", event: "sent" };

    case "cancel":
      if (!OPEN_PO_STATUSES.includes(status)) return wrong();
      return { ok: true, from: OPEN_PO_STATUSES, to: "cancelled", event: "cancelled" };

    default:
      return deny(400, "Unknown action");
  }
}

const ACTION_PAST: Record<PoAction, string> = {
  submit: "submitted",
  approve: "approved",
  reject: "rejected",
  mark_sent: "marked as sent",
  cancel: "cancelled",
};

// ── Order lines ──────────────────────────────────────────────────────────────

export type PoLine = { ingredient_id: number; quantity: number; unit_cost: number };

/** Checks an order's lines. One line per ingredient, quantity and price above 0
 *  (a £0 line would slip a big order under the approval limit). */
export function cleanPoLines(raw: unknown): { ok: true; lines: PoLine[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Add at least one item." };
  const lines: PoLine[] = raw.map((i: Record<string, unknown>) => ({
    ingredient_id: Number(i?.ingredient_id), quantity: Number(i?.quantity), unit_cost: Number(i?.unit_cost),
  }));
  if (lines.some((l) => !Number.isInteger(l.ingredient_id) || l.ingredient_id < 1 || !(l.quantity > 0) || l.quantity > 100000
    || !(l.unit_cost > 0) || l.unit_cost > 100000)) {
    return { ok: false, error: "Every line needs an ingredient, a quantity and today's price (above £0)." };
  }
  if (new Set(lines.map((l) => l.ingredient_id)).size !== lines.length) {
    return { ok: false, error: "The same ingredient is on two lines. Put it on one line with the total quantity." };
  }
  return { ok: true, lines };
}

// ── Receiving ────────────────────────────────────────────────────────────────

export const REJECTION_REASONS = ["damaged", "wrong_item", "short_dated", "temperature", "quality", "other"] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
export const REJECTION_LABEL: Record<RejectionReason, string> = {
  damaged: "Damaged",
  wrong_item: "Wrong item",
  short_dated: "Out of date / short date",
  temperature: "Wrong temperature",
  quality: "Poor quality",
  other: "Other",
};

/** received_quantity is what ARRIVED; rejected_quantity of that was refused at
 *  the door (with a reason). Only arrived − rejected goes into stock. */
export type ReceivedLine = {
  item_id: number; received_quantity?: number; expiry_date?: string; unit_cost?: number;
  rejected_quantity?: number; rejection_reason?: RejectionReason;
};

// Checks one delivery line from the receive screen. Returns null when it's
// unusable. A missing quantity means the line arrived as ordered; a missing
// price means the invoice price matches the order.
export function cleanReceivedLine(raw: unknown): ReceivedLine | null {
  if (!raw || typeof raw !== "object") return null;
  const { item_id, received_quantity, expiry_date, unit_cost, rejected_quantity, rejection_reason } = raw as Record<string, unknown>;
  const id = Number(item_id);
  if (!Number.isInteger(id) || id < 1) return null;
  const line: ReceivedLine = { item_id: id };
  if (received_quantity != null && received_quantity !== "") {
    const qty = Number(received_quantity);
    if (!Number.isFinite(qty) || qty < 0) return null;
    line.received_quantity = qty;
  }
  if (rejected_quantity != null && rejected_quantity !== "" && Number(rejected_quantity) !== 0) {
    const rejected = Number(rejected_quantity);
    if (!Number.isFinite(rejected) || rejected < 0) return null;
    // Can't refuse more than arrived (arrived defaults to the ordered amount, checked in SQL).
    if (line.received_quantity != null && rejected > line.received_quantity) return null;
    if (!REJECTION_REASONS.includes(rejection_reason as RejectionReason)) return null;
    line.rejected_quantity = rejected;
    line.rejection_reason = rejection_reason as RejectionReason;
  }
  if (unit_cost != null && unit_cost !== "") {
    const price = Number(unit_cost);
    if (!(price > 0) || price > 100000) return null;
    line.unit_cost = price;
  }
  if (expiry_date != null && expiry_date !== "") {
    if (typeof expiry_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiry_date) || Number.isNaN(Date.parse(expiry_date))) return null;
    line.expiry_date = expiry_date;
  }
  return line;
}

// ── Suggested order ──────────────────────────────────────────────────────────

export type SuggestIngredient = {
  id: number; name: string; unit: string; supplier_id: number | null;
  current_stock: number; reorder_level: number; reorder_quantity: number; cost_per_unit: number;
};

export type SuggestLine = {
  ingredient_id: number; name: string; unit: string; supplier_id: number | null;
  current_stock: number; reorder_level: number; on_order: number; quantity: number; unit_cost: number;
};

/**
 * Items at or below their reorder level, less what's already on order. The
 * amount is the ingredient's reorder quantity, or, when that isn't set,
 * enough to get back up to twice the reorder level. Only a suggestion — it
 * fills a draft order the manager can change.
 */
export function suggestOrder(ingredients: SuggestIngredient[], onOrder: Map<number, number>): SuggestLine[] {
  const out: SuggestLine[] = [];
  for (const i of ingredients) {
    const stock = Number(i.current_stock) || 0;
    const level = Number(i.reorder_level) || 0;
    const coming = onOrder.get(i.id) ?? 0;
    if (level <= 0 || stock + coming > level) continue;
    const reorderQty = Number(i.reorder_quantity) || 0;
    const qty = reorderQty > 0 ? reorderQty : Math.max(0, level * 2 - stock - coming);
    if (qty <= 0) continue;
    out.push({
      ingredient_id: i.id, name: i.name, unit: i.unit, supplier_id: i.supplier_id,
      current_stock: stock, reorder_level: level, on_order: coming,
      quantity: Math.round(qty * 1000) / 1000, unit_cost: Number(i.cost_per_unit) || 0,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
