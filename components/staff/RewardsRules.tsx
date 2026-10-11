"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_SHARE_MESSAGE } from "@/lib/share-message";

// Staff Hub → Customers & Loyalty → Rules: the Rewards Club numbers, kept in
// each business's own settings (business_settings) so they can change without a rebuild.

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Form = {
  pointsPerPound: string;
  doubleDays: number[];
  maxPerVisit: string;
  redeemStep: string;
  signupPoints: string;
  visit2: string;
  visit3: string;
  everyN: string;
  everyPoints: string;
  referralMinSpend: string;
  rewardMinSpend: string;
  referralMaxPerYear: string;
  expiryMonths: string;
  shareMessage: string;
};

const num = (v: unknown, d = "") => (v == null ? d : String(v));

// Outside the component so inputs inside keep focus while typing.
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

export default function RewardsRules({ canEdit }: { canEdit: boolean }) {
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const s = (d?.settings ?? {}) as Record<string, unknown>;
        const fixed = (s.loyalty_visit_bonus_fixed ?? {}) as Record<string, unknown>;
        setForm({
          pointsPerPound: num(s.loyalty_points_per_pound, "10"),
          doubleDays: Array.isArray(s.loyalty_double_points_days) ? (s.loyalty_double_points_days as number[]).map(Number) : [],
          maxPerVisit: num(s.loyalty_max_redeem_per_visit, "10"),
          redeemStep: num(s.loyalty_redeem_step, "5"),
          signupPoints: num(s.loyalty_signup_points, "0"),
          visit2: num(fixed["2"], "0"),
          visit3: num(fixed["3"], "0"),
          everyN: num(s.loyalty_visit_bonus_every_n, "0"),
          everyPoints: num(s.loyalty_visit_bonus_every_points, "0"),
          referralMinSpend: num(s.loyalty_referral_min_spend, "20"),
          rewardMinSpend: num(s.loyalty_reward_min_spend, "15"),
          referralMaxPerYear: num(s.loyalty_referral_max_per_year, "10"),
          expiryMonths: num(s.loyalty_points_expiry_months, "12"),
          shareMessage: typeof s.loyalty_share_message === "string" && s.loyalty_share_message.trim() ? s.loyalty_share_message : DEFAULT_SHARE_MESSAGE,
        });
      })
      .catch(() => {});
  }, []);

  if (!form) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const n = (v: string) => Math.max(0, Number(v) || 0);

  async function save() {
    if (!form) return;
    if (!form.shareMessage.includes("{link}")) {
      toast({ variant: "destructive", title: "The share message needs {link} where the member's link goes" });
      return;
    }
    if (n(form.redeemStep) > n(form.maxPerVisit)) {
      toast({ variant: "destructive", title: "Step can't be bigger than the max per visit" });
      return;
    }
    setSaving(true);
    const fixed: Record<string, number> = {};
    if (n(form.visit2) > 0) fixed["2"] = n(form.visit2);
    if (n(form.visit3) > 0) fixed["3"] = n(form.visit3);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loyalty_points_per_pound: n(form.pointsPerPound) || 1,
        loyalty_double_points_days: form.doubleDays,
        loyalty_max_redeem_per_visit: n(form.maxPerVisit),
        loyalty_redeem_step: n(form.redeemStep),
        loyalty_signup_points: n(form.signupPoints),
        loyalty_visit_bonus_fixed: fixed,
        loyalty_visit_bonus_every_n: n(form.everyN),
        loyalty_visit_bonus_every_points: n(form.everyPoints),
        loyalty_referral_min_spend: n(form.referralMinSpend),
        loyalty_reward_min_spend: n(form.rewardMinSpend),
        loyalty_referral_max_per_year: n(form.referralMaxPerYear),
        loyalty_points_expiry_months: n(form.expiryMonths),
        loyalty_share_message: form.shareMessage,
      }),
    });
    setSaving(false);
    toast(res.ok ? { variant: "success", title: "Rewards rules saved" } : { variant: "destructive", title: "Couldn't save the rules" });
  }

  const input = "w-24 rounded-lg border border-border bg-surface-hover px-2 py-1.5 text-sm text-foreground disabled:opacity-60";
  const box = (k: keyof Form, suffix?: string) => (
    <>
      <input type="number" min={0} value={form[k] as string} onChange={set(k)} disabled={!canEdit} className={input} />
      {suffix && <span>{suffix}</span>}
    </>
  );

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Earning</h3>
        <div className="rounded-xl border border-border bg-surface">
          <Row label="Points per £1 spent">{box("pointsPerPound", "pts")}</Row>
          <Row label="Double points days" hint="Judged on the trading day (5am–5am)">
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d, i) => {
                const on = form.doubleDays.includes(i + 1);
                return (
                  <button
                    key={d}
                    disabled={!canEdit}
                    onClick={() => setForm({ ...form, doubleDays: on ? form.doubleDays.filter((x) => x !== i + 1) : [...form.doubleDays, i + 1].sort() })}
                    className={`rounded-md px-2 py-1 text-xs font-semibold ${on ? "bg-red-500 text-white" : "bg-surface-hover text-muted-foreground"}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </Row>
          <Row label="Sign-up points">{box("signupPoints", "pts")}</Row>
          <Row label="Points expire after">{box("expiryMonths", "months")}</Row>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Visit bonuses</h3>
        <div className="rounded-xl border border-border bg-surface">
          <Row label="2nd visit">{box("visit2", "pts")}</Row>
          <Row label="3rd visit">{box("visit3", "pts")}</Row>
          <Row label="Every Nth visit" hint="e.g. every 5th: 5th, 10th, 15th…">
            every {box("everyN")} → {box("everyPoints", "pts")}
          </Row>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Spending (dine-in only)</h3>
        <div className="rounded-xl border border-border bg-surface">
          <Row label="Max points per visit" hint="100 points = £1">£{box("maxPerVisit")}</Row>
          <Row label="Use points in steps of">£{box("redeemStep")}</Row>
          <Row label="Minimum spend to use any reward" hint="Codes and points: the food bill before the reward. One reward per bill.">£{box("rewardMinSpend")}</Row>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Bring a Friend</h3>
        <div className="rounded-xl border border-border bg-surface">
          <Row label="Friend's first order must be at least">£{box("referralMinSpend")}</Row>
          <Row label="Max £5 vouchers per member per year">{box("referralMaxPerYear")}</Row>
          <div className="border-t border-border px-4 py-3">
            <div className="text-sm font-medium text-foreground">Share message</div>
            <div className="text-xs text-muted-foreground">
              What members send when they tap Share my link or WhatsApp. <b>{"{link}"}</b> becomes their own join link.
            </div>
            <textarea
              value={form.shareMessage}
              onChange={(e) => setForm({ ...form, shareMessage: e.target.value })}
              disabled={!canEdit}
              rows={9}
              className="mt-2 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-foreground disabled:opacity-60"
            />
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setForm({ ...form, shareMessage: DEFAULT_SHARE_MESSAGE })}
              className="mt-1 text-xs text-muted-foreground underline disabled:opacity-60"
            >
              Reset to the standard message
            </button>
          </div>
        </div>
      </section>

      {canEdit ? (
        <button onClick={save} disabled={saving} className="h-10 w-full rounded-xl bg-red-500 font-semibold text-white hover:bg-red-600 disabled:opacity-50">
          {saving ? "Saving…" : "Save rules"}
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">Only managers can change these.</p>
      )}
    </div>
  );
}
