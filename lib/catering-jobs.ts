import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { r2 } from "@/lib/finance";

// Catering & events jobs (migration 133, agreed 2026-10-13). A job is entered
// once with its total; each payment (part payments too) is a Money In entry
// (cash_movements, category "job_payment") pointing at it, so what's still
// owed is worked out, never retyped.
//   • Cash and bank transfer payments count as sales on the day received
//     (catering → Catering, event → Events) — money taken outside the till.
//   • Card payments on our card machine are already in the Z report, so they
//     count toward what the customer has paid but not again as sales.
//   • Cash payments move the drawer like any Money In (cash check, cash book).

export type JobKind = "catering" | "event";
export const JOB_KINDS: { key: JobKind; label: string; icon: string }[] = [
  { key: "catering", label: "Catering", icon: "🍱" },
  { key: "event", label: "Event", icon: "🎉" },
];
export const jobKindLabel = (k: string) => JOB_KINDS.find((x) => x.key === k)?.label ?? k;

/** Payment methods that are sales here (card is already in the Z report). */
export const SALES_METHODS = ["cash", "bank"];
export const countsAsSales = (method: string | null | undefined) => SALES_METHODS.includes(String(method ?? "cash"));

export type JobPayment = { id: number; date: string; amount: number; method: string; note: string | null; by: string | null };
export type Job = {
  id: number; kind: JobKind; customer: string; phone: string | null; date: string;
  total: number; notes: string | null; cancelled: boolean;
  paid: number; owed: number; payments: JobPayment[];
};

const JOB_COLUMNS = "id, kind, customer, phone, job_date, total, notes, cancelled";
type JobRow = { id: number; kind: JobKind; customer: string; phone: string | null; job_date: string; total: number; notes: string | null; cancelled: boolean };
type PayRow = { id: number; job_id: number; movement_date: string; amount: number; method: string | null; reason: string | null; staff_id: number | null };

/** Jobs with their payments and what's owed (cancelled jobs owe nothing). */
async function withPayments(businessId: number, jobs: JobRow[]): Promise<Job[]> {
  if (!jobs.length) return [];
  const db = bizDb(businessId);
  const { data: pays } = await db.from("cash_movements")
    .select("id, job_id, movement_date, amount, method, reason, staff_id")
    .in("job_id", jobs.map((j) => j.id)).order("movement_date").order("id");
  const ids = [...new Set((pays ?? []).map((p) => p.staff_id).filter(Boolean))] as number[];
  const { data: who } = ids.length ? await supabase.from("staff").select("id, name").in("id", ids) : { data: [] as { id: number; name: string }[] };
  const nameOf = (id: number | null) => (who ?? []).find((w) => w.id === id)?.name ?? null;
  return jobs.map((j) => {
    const payments = ((pays ?? []) as PayRow[]).filter((p) => p.job_id === j.id).map((p) => ({
      id: p.id, date: p.movement_date, amount: r2(Number(p.amount)), method: p.method ?? "cash",
      note: p.reason, by: nameOf(p.staff_id),
    }));
    const paid = r2(payments.reduce((s, p) => s + p.amount, 0));
    const total = r2(Number(j.total));
    return {
      id: j.id, kind: j.kind, customer: j.customer, phone: j.phone, date: j.job_date, total,
      notes: j.notes, cancelled: j.cancelled, paid, owed: j.cancelled ? 0 : r2(Math.max(0, total - paid)), payments,
    };
  });
}

/** The jobs on the list: every job still owed money, plus the month's jobs. */
export async function listJobs(businessId: number, month: string): Promise<{ owed: Job[]; month: Job[] }> {
  const db = bizDb(businessId);
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const [{ data: inMonth }, { data: open }] = await Promise.all([
    db.from("catering_jobs").select(JOB_COLUMNS).gte("job_date", from).lte("job_date", to).order("job_date").order("id"),
    db.from("catering_jobs").select(JOB_COLUMNS).eq("cancelled", false).order("job_date").order("id"),
  ]);
  const all = await withPayments(businessId, [...new Map([...(inMonth ?? []), ...(open ?? [])].map((j) => [j.id, j as JobRow])).values()]);
  const byId = new Map(all.map((j) => [j.id, j]));
  return {
    owed: (open ?? []).map((j) => byId.get(j.id)!).filter((j) => j.owed > 0),
    month: (inMonth ?? []).map((j) => byId.get(j.id)!),
  };
}

export async function getJob(businessId: number, id: number): Promise<Job | null> {
  const { data } = await bizDb(businessId).from("catering_jobs").select(JOB_COLUMNS).eq("id", id).maybeSingle();
  return data ? (await withPayments(businessId, [data as JobRow]))[0] : null;
}

/** Jobs a payment can be recorded against (staff link): open and still owed. */
export async function payableJobs(businessId: number): Promise<{ id: number; label: string; owed: number }[]> {
  const { owed } = await listJobs(businessId, new Date().toISOString().slice(0, 7));
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return owed.map((j) => ({ id: j.id, label: `${j.kind === "event" ? "🎉" : "🍱"} ${j.customer} · ${day(j.date)} · £${j.owed.toFixed(2)} owed`, owed: j.owed }));
}

/** Per day, the job payments that count as sales: catering and events. */
export async function jobSalesByDay(businessId: number, from: string, to: string): Promise<{ catering: Map<string, number>; events: Map<string, number> }> {
  const db = bizDb(businessId);
  const { data: pays } = await db.from("cash_movements").select("job_id, movement_date, amount, method")
    .not("job_id", "is", null).gte("movement_date", from).lte("movement_date", to);
  const catering = new Map<string, number>();
  const events = new Map<string, number>();
  const counted = (pays ?? []).filter((p) => countsAsSales(p.method));
  if (!counted.length) return { catering, events };
  const { data: jobs } = await db.from("catering_jobs").select("id, kind").in("id", [...new Set(counted.map((p) => p.job_id))]);
  const kind = new Map((jobs ?? []).map((j) => [j.id, j.kind as JobKind]));
  for (const p of counted) {
    const m = kind.get(p.job_id) === "event" ? events : catering;
    m.set(p.movement_date, r2((m.get(p.movement_date) ?? 0) + Number(p.amount)));
  }
  return { catering, events };
}
