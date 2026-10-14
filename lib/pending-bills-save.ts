import { bizDb } from "@/lib/business-db";
import { getBill } from "@/lib/pending-bills";
import { r2 } from "@/lib/finance";
import { tradingDayStr } from "@/lib/london-date";
import { addDays } from "@/lib/admin-dashboard";

// Saving pending bills and their payments (134) — Daily accounts and the Day
// End link check the same things. Tracking only: nothing here is sales or cash.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = ["cash", "card", "bank"];
const money = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? r2(n) : NaN;
};

export function parseBill(body: unknown, fallbackDate?: string): { customer: string; phone: string | null; bill_date: string; amount: number; notes: string | null } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const customer = String(b.customer ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!customer) return { error: "Who owes it? Enter the customer's name." };
  const amount = money(b.amount);
  if (!(amount > 0)) return { error: `Enter the amount ${customer} owes.` };
  if (amount > 50000) return { error: "That amount looks too big. Check it." };
  const date = DATE.test(String(b.date ?? "")) ? String(b.date) : fallbackDate ?? "";
  if (!DATE.test(date)) return { error: "Pick the date of the bill." };
  const phone = String(b.phone ?? "").trim().slice(0, 30) || null;
  const notes = String(b.notes ?? "").trim().slice(0, 300) || null;
  return { customer, phone, bill_date: date, amount, notes };
}

export async function addBillPayment(
  businessId: number, billId: number, staffId: number,
  p: { amount: unknown; method?: unknown; date?: unknown }, source: "staff_hub" | "link",
): Promise<{ ok: true } | { error: string; status?: number }> {
  const bill = await getBill(businessId, billId);
  if (!bill) return { error: "That bill isn't on the list.", status: 404 };
  if (bill.cancelled) return { error: "That bill was cancelled." };
  const amount = money(p.amount);
  if (!(amount > 0)) return { error: "Enter the amount paid." };
  if (amount > r2(bill.owed + 0.001)) return { error: `Only £${bill.owed.toFixed(2)} is still owed by ${bill.customer}.` };
  const today = tradingDayStr();
  const date = DATE.test(String(p.date ?? "")) ? String(p.date) : today;
  if (date > today || date < addDays(today, -62)) return { error: "Pick today or a day in the last two months." };
  if (date < bill.date) return { error: "The payment can't be before the bill." };
  const method = METHODS.includes(String(p.method)) ? String(p.method) : "cash";
  const { error } = await bizDb(businessId).from("pending_bill_payments").insert({ bill_id: bill.id, paid_date: date, amount, method, staff_id: staffId, source });
  if (error) return { error: "Couldn't save the payment. Please try again.", status: 500 };
  return { ok: true };
}
