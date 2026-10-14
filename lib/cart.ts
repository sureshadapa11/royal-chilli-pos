// Shared cart model for the collection/delivery ordering flow (localStorage-persisted,
// survives navigating from /order to /order/checkout). Dine-in has its own ephemeral
// "send to kitchen" flow in DineInOrder.tsx and doesn't use this.

export type SelectedOption = { id: number; name: string; price_delta: number };

export type CartLine = {
  lineId: string;
  menu_item_id: number;
  name: string;
  // The dish's two base prices (see PriceType in lib/menu.ts) — the line's
  // price follows whichever of Collection / Delivery is selected, so switching
  // re-prices the whole basket. Missing on baskets saved before this existed.
  collectionPrice?: number;
  deliveryPrice?: number;
  unitPrice: number; // price when added (base + option deltas) — fallback for old baskets
  quantity: number;
  selectedOptions: SelectedOption[];
  notes?: string;
};

const CART_KEY = "rc_cart";

// Two lines are the same if they're the same dish with the exact same modifier
// selections and the exact same special instructions — e.g. "Mild" curry and
// "Hot" curry, or the same curry with different notes, must stay separate.
export function makeLineId(menuItemId: number, optionIds: number[], notes?: string): string {
  return `${menuItemId}:${[...optionIds].sort((a, b) => a - b).join(",")}:${(notes || "").trim()}`;
}

/** A basket line with a new note (its id follows, so it stays its own line). */
export function withNote(lines: CartLine[], lineId: string, note: string): CartLine[] {
  return lines.map((l) => (l.lineId === lineId
    ? { ...l, notes: note || undefined, lineId: makeLineId(l.menu_item_id, l.selectedOptions.map((o) => o.id), note) }
    : l));
}

export type OrderType = "takeaway" | "delivery";

// One unit of this line at the selected order type's prices. Display only —
// the server re-prices every order (app/api/public/orders).
export function lineUnitPrice(line: CartLine, orderType: OrderType): number {
  const base = orderType === "delivery" ? line.deliveryPrice : line.collectionPrice;
  if (base === undefined) return line.unitPrice;
  return Math.round((base + line.selectedOptions.reduce((s, o) => s + o.price_delta, 0)) * 100) / 100;
}

export function cartTotal(cart: CartLine[], orderType: OrderType): number {
  return Math.round(cart.reduce((sum, l) => sum + lineUnitPrice(l, orderType) * l.quantity, 0) * 100) / 100;
}
const ORDER_TYPE_KEY = "rc_order_type";

export function readOrderType(): OrderType {
  if (typeof window === "undefined") return "takeaway";
  return localStorage.getItem(ORDER_TYPE_KEY) === "delivery" ? "delivery" : "takeaway";
}

export function writeOrderType(type: OrderType) {
  localStorage.setItem(ORDER_TYPE_KEY, type);
}

export function readCart(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
  } catch {
    return [];
  }
}

export function writeCart(cart: CartLine[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}
