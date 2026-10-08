export type ReceivedLine = { item_id: number; received_quantity?: number; expiry_date?: string };

// Checks one delivery line from the receive screen. Returns null when it's
// unusable. A missing quantity means the line arrived as ordered.
export function cleanReceivedLine(raw: unknown): ReceivedLine | null {
  if (!raw || typeof raw !== "object") return null;
  const { item_id, received_quantity, expiry_date } = raw as Record<string, unknown>;
  const id = Number(item_id);
  if (!Number.isInteger(id) || id < 1) return null;
  const line: ReceivedLine = { item_id: id };
  if (received_quantity != null && received_quantity !== "") {
    const qty = Number(received_quantity);
    if (!Number.isFinite(qty) || qty < 0) return null;
    line.received_quantity = qty;
  }
  if (expiry_date != null && expiry_date !== "") {
    if (typeof expiry_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiry_date) || Number.isNaN(Date.parse(expiry_date))) return null;
    line.expiry_date = expiry_date;
  }
  return line;
}
