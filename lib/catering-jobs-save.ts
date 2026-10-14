import { bizDb } from "@/lib/business-db";
import { getJob, type JobKind } from "@/lib/catering-jobs";
import { r2 } from "@/lib/finance";
import { tradingDayStr } from "@/lib/london-date";
import { addDays } from "@/lib/admin-dashboard";

// Saving catering & events jobs and their payments (133) — shared by Daily
// accounts and the staff link, so both check the same things.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = ["cash", "card", "bank"];
const money = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? r2(n) : NaN;
};

/** A job's fields from a form, checked. */
export function parseJob(body: unknown): { kind: JobKind; customer: string; phone: string | null; job_date: string; total: number; notes: string | null } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = b.kind === "event" ? "event" : b.kind === "catering" ? "catering" : null;
  if (!kind) return { error: "Choose Catering or Event." };
  const customer = String(b.customer ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!customer) return { error: "Who is it for? Enter the customer's name." };
  const date = String(b.date ?? "");
  if (!DATE.test(date)) return { error: "Pick the date of the job." };
  const total = money(b.total);
  if (!(total > 0)) return { error: "Enter the job's total price." };
  if (total > 100000) return { error: "That total looks too big. Check it." };
  const phone = String(b.phone ?? "").trim().slice(0, 30) || null;
  const notes = String(b.notes ?? "").trim().slice(0, 500) || null;
  return { kind, customer, phone, job_date: date, total, notes };
}

/**
 * A payment towards a job: a Money In entry (cash_movements, job_payment)
 * linked to it. Refuses paying more than is owed, and cancelled jobs.
 */
export async function addJobPayment(
  businessId: number, jobId: number, staffId: number,
  p: { amount: unknown; method?: unknown; date?: unknown; note?: unknown; place?: unknown },
  source: "staff_hub" | "link",
): Promise<{ ok: true; id: number } | { error: string; status?: number }> {
  const job = await getJob(businessId, jobId);
  if (!job) return { error: "That job isn't on the list.", status: 404 };
  if (job.cancelled) return { error: "That job was cancelled.", status: 400 };
  const amount = money(p.amount);
  if (!(amount > 0)) return { error: "Enter the amount paid." };
  if (amount > r2(job.owed + 0.001)) return { error: `Only £${job.owed.toFixed(2)} is still owed on this job.` };
  const method = METHODS.includes(String(p.method)) ? String(p.method) : "cash";
  const today = tradingDayStr();
  const date = DATE.test(String(p.date ?? "")) ? String(p.date) : today;
  if (date > today || date < addDays(today, -62)) return { error: "Pick today or a day in the last two months." };
  const note = String(p.note ?? "").trim().slice(0, 200);
  const { data, error } = await bizDb(businessId).from("cash_movements").insert({
    movement_date: date, direction: "in", category: "job_payment", amount, method,
    // Cash goes to the Safe (136); card / bank aren't in either cash book.
    place: method === "cash" ? "safe" : "till",
    reason: [`${job.kind === "event" ? "Event" : "Catering"}: ${job.customer}`, note].filter(Boolean).join(" · "),
    paid_to: null, staff_id: staffId, source, job_id: job.id,
  }).select("id").single();
  if (error || !data) return { error: "Couldn't save the payment. Please try again.", status: 500 };
  return { ok: true, id: data.id };
}
