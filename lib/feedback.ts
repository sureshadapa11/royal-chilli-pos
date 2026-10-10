// Guest feedback ("How was your meal?"): the topics guests tap, checking a
// submission, and the summaries the Staff Hub and the Monday report show.
// Pure and safe to import in the browser.

export const FEEDBACK_TOPICS = [
  { key: "food", label: "Food" },
  { key: "service", label: "Service" },
  { key: "wait", label: "Waiting time" },
  { key: "price", label: "Price / value" },
  { key: "clean", label: "Cleanliness" },
  { key: "atmosphere", label: "Atmosphere" },
] as const;
export type FeedbackTopic = (typeof FEEDBACK_TOPICS)[number]["key"];
export const topicLabel = (k: string) => FEEDBACK_TOPICS.find((t) => t.key === k)?.label ?? k;

export const FEEDBACK_SOURCES = ["table", "receipt", "email", "web"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

/** 1–3 stars: someone should get back to them. */
export const NEEDS_CALL_BACK = 3;

export type FeedbackInput = {
  rating: number;
  liked: FeedbackTopic[];
  improve: FeedbackTopic[];
  comment: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  contact_ok: boolean;
  source: FeedbackSource;
  table_label: string | null;
};

const clean = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const topics = (v: unknown): FeedbackTopic[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is FeedbackTopic => FEEDBACK_TOPICS.some((t) => t.key === x)))] : [];

/** Check what the form sent. Returns the clean row, or the reason it can't be saved. */
export function parseFeedback(body: Record<string, unknown> | null): { ok: true; value: FeedbackInput } | { ok: false; error: string } {
  const rating = Number(body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: "Please choose 1 to 5 stars" };
  const email = clean(body?.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right" };
  const phone = clean(body?.phone, 30);
  if (phone && phone.replace(/\D/g, "").length < 10) return { ok: false, error: "That phone number looks too short" };
  const source = FEEDBACK_SOURCES.includes(body?.source as FeedbackSource) ? (body!.source as FeedbackSource) : "web";
  return {
    ok: true,
    value: {
      rating, liked: topics(body?.liked), improve: topics(body?.improve),
      comment: clean(body?.comment, 1000), name: clean(body?.name, 80), phone, email,
      contact_ok: body?.contact_ok === true && !!(phone || email),
      source, table_label: clean(body?.table, 20),
    },
  };
}

export type FeedbackRow = {
  id: number; created_at: string; rating: number; liked: string[]; improve: string[];
  comment: string | null; name: string | null; phone: string | null; email: string | null; contact_ok: boolean;
  customer_id: number | null; source: string; table_label: string | null;
  handled_at: string | null; handled_note: string | null;
};

export type FeedbackSummary = {
  count: number;
  average: number | null;              // stars, 1 decimal
  stars: [number, number, number, number, number]; // how many 1★ … 5★
  liked: { key: string; label: string; count: number }[];   // most first
  improve: { key: string; label: string; count: number }[];
  open: number;                        // 1–3★ not yet called back
};

/** Totals for a list of feedback (pure). */
export function summariseFeedback(rows: FeedbackRow[]): FeedbackSummary {
  const stars: FeedbackSummary["stars"] = [0, 0, 0, 0, 0];
  for (const r of rows) stars[r.rating - 1]++;
  const tally = (pick: (r: FeedbackRow) => string[]) =>
    FEEDBACK_TOPICS.map((t) => ({ key: t.key as string, label: t.label as string, count: rows.filter((r) => pick(r).includes(t.key)).length }))
      .filter((t) => t.count > 0).sort((a, b) => b.count - a.count);
  return {
    count: rows.length,
    average: rows.length ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 10) / 10 : null,
    stars,
    liked: tally((r) => r.liked),
    improve: tally((r) => r.improve),
    open: rows.filter((r) => r.rating <= NEEDS_CALL_BACK && !r.handled_at).length,
  };
}
