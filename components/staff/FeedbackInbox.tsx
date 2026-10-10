"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { useToast } from "@/hooks/use-toast";
import { topicLabel, type FeedbackRow, type FeedbackSummary } from "@/lib/feedback";
import { SITE_URL } from "@/lib/site-url";
import type { WinBackStats } from "@/lib/winback";

// Staff Hub → Customers → Feedback: what guests said on "How was your meal?".
// 1–3★ wait under "To follow up" until someone marks them handled (with a
// note of what was done). The table QR card prints the feedback link.

type Data = { days: number; rows: FeedbackRow[]; open: FeedbackRow[]; summary: FeedbackSummary; winBack: WinBackStats };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
const SOURCE: Record<string, string> = { table: "Table QR", receipt: "Receipt QR", email: "Email", web: "Website" };

function Stars({ n }: { n: number }) {
  return <span className={`tracking-[1px] ${n <= 3 ? "text-red-600" : "text-amber-500"}`} aria-label={`${n} out of 5 stars`}>{stars(n)}</span>;
}

function Topics({ row }: { row: FeedbackRow }) {
  if (!row.liked.length && !row.improve.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[12px]">
      {row.liked.map((t) => <span key={`l${t}`} className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">👍 {topicLabel(t)}</span>)}
      {row.improve.map((t) => <span key={`i${t}`} className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-700">👎 {topicLabel(t)}</span>)}
    </div>
  );
}

function Who({ row }: { row: FeedbackRow }) {
  const bits = [row.name, row.phone, row.email].filter(Boolean);
  return (
    <p className="text-[12.5px] text-muted-foreground">
      {when(row.created_at)} · {SOURCE[row.source] ?? row.source}{row.table_label ? ` · table ${row.table_label}` : ""}
      {bits.length > 0 && <> · <span className="text-foreground">{bits.join(" · ")}</span></>}
      {row.contact_ok && <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700">happy to be contacted</span>}
      {row.customer_id && <span className="ml-1.5 rounded bg-[#F6F1E6] px-1.5 py-0.5 text-[11px] font-semibold">Rewards Club member</span>}
    </p>
  );
}

function FollowUp({ row, onDone }: { row: FeedbackRow; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  async function done() {
    setBusy(true);
    const res = await fetch("/api/staff/feedback", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, note }) });
    setBusy(false);
    if (!res.ok) return toast({ title: "Not saved", description: "Please try again", variant: "destructive" });
    toast({ title: "Marked as handled" });
    onDone();
  }
  return (
    <div className="rounded-xl border border-red-200 bg-white p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><Stars n={row.rating} /><Who row={row} /></div>
      <Topics row={row} />
      {row.comment && <p className="mt-2 whitespace-pre-wrap text-[14px]">&ldquo;{row.comment}&rdquo;</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What was done? e.g. Called, apologised, free dessert next visit"
          aria-label="What was done" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <button onClick={done} disabled={busy} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
          {busy ? "Saving…" : "Mark as handled"}
        </button>
      </div>
    </div>
  );
}

async function printTableCard(businessName: string) {
  const url = `${SITE_URL}/feedback?src=table`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Feedback QR card</title><style>
    @page { size: A6 portrait; margin: 8mm; }
    body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #1C1917; text-align: center; }
    .card { padding: 10mm 6mm; }
    h1 { font-size: 26px; margin: 0 0 4px; } p { font-family: Arial, sans-serif; font-size: 13px; margin: 0; color: #57534E; }
    .qr svg { width: 62mm; height: 62mm; margin: 6mm auto 4mm; display: block; }
    .small { font-size: 10.5px; margin-top: 3mm; }
  </style></head><body><div class="card">
    <p style="letter-spacing:.2em;text-transform:uppercase;font-size:10px;color:#B8281A">${businessName.replace(/</g, "&lt;")}</p>
    <h1>How was your meal?</h1>
    <p>Scan to tell us. It takes less than a minute.</p>
    <div class="qr">${qr}</div>
    <p class="small">${url.replace(/^https:\/\//, "")}</p>
  </div><script>window.onload=function(){window.focus();window.print();}<\/script></body></html>`);
  w.document.close();
}

export default function FeedbackInbox({ businessName }: { businessName: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const res = await fetch(`/api/staff/feedback?days=${days}`, { cache: "no-store" });
    if (!res.ok) return setError("Couldn't load feedback");
    setData(await res.json());
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const s = data?.summary;
  const maxStars = Math.max(1, ...(s?.stars ?? [1]));
  return (
    <div className="mt-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-surface-hover p-1">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} aria-pressed={days === d}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${days === d ? "bg-white text-foreground shadow-sm" : "text-muted-foreground"}`}>Last {d} days</button>
          ))}
        </div>
        <button onClick={() => printTableCard(businessName)} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-surface-hover">🖨 Print table QR card</button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Responses", String(s!.count)],
              ["Average", s!.average != null ? `${s!.average.toFixed(1)} ★` : "—"],
              ["5★", String(s!.stars[4])],
              ["To follow up", String(data.open.length)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-border bg-white px-3.5 py-3">
                <span className="block text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{l}</span>
                <b style={{ fontFamily: "var(--font-space-grotesk)" }} className={`text-[22px] font-bold ${l === "To follow up" && data.open.length ? "text-red-600" : ""}`}>{v}</b>
              </div>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-white p-3.5">
              <h3 className="text-sm font-semibold">Ratings</h3>
              <div className="mt-2 space-y-1.5">
                {[5, 4, 3, 2, 1].map((n) => (
                  <div key={n} className="grid grid-cols-[2.2em_1fr_2em] items-center gap-2 text-[12.5px] tabular-nums">
                    <span>{n} ★</span>
                    <div className="h-2 rounded-full bg-[#F3EEE3]"><div className="h-full rounded-full" style={{ width: `${(s!.stars[n - 1] / maxStars) * 100}%`, background: n <= 3 ? "#C0392B" : "#E2A33A" }} /></div>
                    <span className="text-right text-muted-foreground">{s!.stars[n - 1]}</span>
                  </div>
                ))}
              </div>
            </div>
            {([["What guests loved", s!.liked, "bg-emerald-600"], ["What could be better", s!.improve, "bg-red-600"]] as const).map(([title, list, colour]) => (
              <div key={title} className="rounded-xl border border-border bg-white p-3.5">
                <h3 className="text-sm font-semibold">{title}</h3>
                {list.length === 0 ? <p className="mt-2 text-[12.5px] text-muted-foreground">Nothing yet.</p> : (
                  <div className="mt-2 space-y-1.5">
                    {list.map((t) => (
                      <div key={t.key} className="grid grid-cols-[1fr_auto] items-center gap-2 text-[13px]">
                        <div><span>{t.label}</span><div className="mt-0.5 h-1.5 rounded-full bg-[#F3EEE3]"><div className={`h-full rounded-full ${colour}`} style={{ width: `${(t.count / list[0].count) * 100}%` }} /></div></div>
                        <span className="tabular-nums text-muted-foreground">{t.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <section>
            <h2 className="text-[15px] font-semibold">To follow up <span className="text-muted-foreground font-normal">· 1–3★ not yet handled</span></h2>
            {data.open.length === 0
              ? <p className="mt-2 rounded-xl bg-[#FBF8F1] px-3 py-4 text-sm text-muted-foreground">Nothing waiting. Every unhappy guest has been followed up.</p>
              : <div className="mt-2 space-y-2.5">{data.open.map((r) => <FollowUp key={r.id} row={r} onDone={load} />)}</div>}
          </section>

          <section>
            <h2 className="text-[15px] font-semibold">Come-back emails <span className="text-muted-foreground font-normal">· &ldquo;why did you stop coming?&rdquo; after 21 days away, last {data.days} days</span></h2>
            <div className="mt-2 grid gap-3 md:grid-cols-[1fr_2fr]">
              <div className="rounded-xl border border-border bg-white p-3.5">
                <div className="flex gap-6">
                  <div><span className="block text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Sent</span><b style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-[22px] font-bold">{data.winBack.sent}</b></div>
                  <div><span className="block text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Answered</span><b style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-[22px] font-bold">{data.winBack.answered}</b></div>
                </div>
                {data.winBack.reasons.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {data.winBack.reasons.map((r) => (
                      <div key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-2 text-[13px]">
                        <div><span>{r.label}</span><div className="mt-0.5 h-1.5 rounded-full bg-[#F3EEE3]"><div className="h-full rounded-full bg-[#B4532A]" style={{ width: `${(r.count / data.winBack.reasons[0].count) * 100}%` }} /></div></div>
                        <span className="tabular-nums text-muted-foreground">{r.count}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-[12px] text-muted-foreground">Sent once a day to Rewards Club members who said yes to offers. Each reason gives its own offer: edit them in Rewards Catalog (&ldquo;Come-back: …&rdquo;).</p>
              </div>
              <div className="rounded-xl border border-border bg-white">
                {data.winBack.recent.length === 0 ? <p className="px-3.5 py-4 text-sm text-muted-foreground">No answers yet.</p> : (
                  <div className="divide-y divide-border">
                    {data.winBack.recent.map((r, i) => (
                      <div key={i} className="px-3.5 py-2.5 text-[13.5px]">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span><b className="font-semibold">{r.name}</b> · {r.reason}</span>
                          <span className="text-[12.5px] text-muted-foreground">{when(r.answeredAt)}{r.code ? ` · ${r.code}` : ""}{r.used ? " · used ✓" : ""}</span>
                        </div>
                        {r.comment && <p className="mt-1 text-muted-foreground">&ldquo;{r.comment}&rdquo;</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-[15px] font-semibold">All feedback <span className="text-muted-foreground font-normal">· last {data.days} days</span></h2>
            {data.rows.length === 0 ? (
              <p className="mt-2 rounded-xl bg-[#FBF8F1] px-3 py-4 text-sm text-muted-foreground">No feedback yet. Print the table QR card and put it on every table, or share {SITE_URL.replace(/^https:\/\//, "")}/feedback.</p>
            ) : (
              <div className="mt-2 divide-y divide-border rounded-xl border border-border bg-white">
                {data.rows.map((r) => (
                  <div key={r.id} className="p-3.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2"><Stars n={r.rating} /><Who row={r} /></div>
                    <Topics row={r} />
                    {r.comment && <p className="mt-2 whitespace-pre-wrap text-[14px]">&ldquo;{r.comment}&rdquo;</p>}
                    {r.handled_at && <p className="mt-2 text-[12.5px] text-emerald-700">✓ Handled {when(r.handled_at)}{r.handled_note ? `: ${r.handled_note}` : ""}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
