"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import RewardsRules from "@/components/staff/RewardsRules";
import ClubReport from "@/components/staff/ClubReport";
import DuplicatesPanel from "@/components/staff/DuplicatesPanel";
import FeedbackInbox from "@/components/staff/FeedbackInbox";

type Segment = "NEW" | "FIRST_TIME" | "RETURNING" | "REGULAR" | "LAPSED";
type Customer = {
  id: number; name: string; phone: string; email: string | null; date_of_birth: string | null;
  loyalty_points: number; referral_code: string | null; lifetime_spend: number; visit_count: number; tier: string;
  segment: Segment; last_visit: string | null; marketing_consent: boolean;
};
type Reward = {
  id: number; name: string; description: string | null; points_cost: number;
  discount_amount: number | null; min_spend: number; eligible_tier_name: string | null;
  valid_days: number; per_customer_limit: number | null; is_birthday_reward?: boolean;
  is_welcome_reward?: boolean; is_referral_reward?: boolean;
};
type Birthday = { id: number; name: string; phone: string; days_away: number };

// Rewards Club groups (lib/crm.ts computeSegment)
const SEGMENTS: Segment[] = ["NEW", "FIRST_TIME", "RETURNING", "REGULAR", "LAPSED"];
const segmentStyle: Record<Segment, string> = {
  NEW: "text-emerald-700 bg-emerald-50 border-emerald-200",
  FIRST_TIME: "text-amber-700 bg-amber-50 border-amber-200",
  RETURNING: "text-blue-700 bg-blue-50 border-blue-200",
  REGULAR: "text-purple-700 bg-purple-50 border-purple-200",
  LAPSED: "text-red-700 bg-red-50 border-red-200",
};
const segmentLabel: Record<Segment, string> = { NEW: "🟢 New", FIRST_TIME: "🟡 First-time", RETURNING: "🔵 Returning", REGULAR: "🟣 Regular", LAPSED: "🔴 Lapsed" };
const segmentHint: Record<Segment, string> = {
  NEW: "Joined, no visits yet",
  FIRST_TIME: "1 visit",
  RETURNING: "2–4 visits",
  REGULAR: "5+ visits, in within 60 days",
  LAPSED: "No visit in 45+ days",
};
type Tier = { id: number; name: string; min_lifetime_spend: number; points_multiplier: number; sort_order: number; active: number };
type Redemption = {
  id: number; code: string; status: string; issued_at: string; expires_at: string; redeemed_at: string | null;
  points_spent: number; reward: { name: string } | null; customer: { name: string; phone: string } | null;
};

function fmtMoney(n: number) { return `£${Number(n).toFixed(2)}`; }
const tierColor: Record<string, string> = { Gold: "text-amber-600", Silver: "text-foreground", Bronze: "text-red-700" };

function AddCustomerModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [referredBy, setReferredBy] = useState("");
  const { toast } = useToast();

  async function save() {
    if (!name.trim() || !phone.trim()) return toast({ variant: "destructive", title: "Name and phone are required" });
    const res = await fetch("/api/customers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, email: email || undefined, date_of_birth: dob || undefined, referred_by_code: referredBy || undefined }),
    });
    const data = await res.json();
    if (!res.ok) return toast({ variant: "destructive", title: "Couldn't add customer", description: data.error });
    toast({ variant: "success", title: "Customer added", description: `${name.trim()} is now in the loyalty program.` });
    onSaved(); onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto p-5">
        <h2 className="text-foreground font-bold text-lg">New Customer</h2>
        <div className="mt-4 space-y-2">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
          <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
          <input placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
          <div>
            <label className="text-muted-foreground text-xs">Date of birth (for birthday offers)</label>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
          </div>
          <input placeholder="Referral code (optional)" value={referredBy} onChange={(e) => setReferredBy(e.target.value)} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
        </div>
        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className="flex-1 h-10 bg-elevated hover:bg-elevated-hover text-foreground font-semibold rounded-xl">Cancel</button>
          <button onClick={save} className="flex-1 h-10 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl">Save</button>
        </div>
      </div>
    </div>
  );
}

function CustomerDetailModal({ customerId, rewards, isManager, onClose, onChange }: {
  customerId: number; rewards: Reward[]; isManager: boolean; onClose: () => void; onChange: () => void;
}) {
  type Detail = {
    customer: Customer & { favourite_dish: string | null };
    orders: { id: number; order_number: string; order_type: string; status: string; total: number; created_at: string }[];
    transactions: { id: number; points_delta: number; reason: string; created_at: string }[];
  };
  const [detail, setDetail] = useState<Detail | null>(null);
  const [adjustPoints, setAdjustPoints] = useState("");
  const [issuedCode, setIssuedCode] = useState<{ code: string; reward_name: string; expires_at: string } | null>(null);
  const [winbackRewardId, setWinbackRewardId] = useState<string>("");
  const [winbackSending, setWinbackSending] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    const res = await fetch(`/api/customers/${customerId}`);
    const data = await res.json();
    setDetail(data);
  }, [customerId]);
  useEffect(() => { load(); }, [load]);

  // Issues a redemption code (points are debited now) rather than applying
  // the reward instantly — staff relay the code to the customer, who brings
  // it back to redeem at the till, same visit or a later one.
  async function issueReward(rewardId: number, rewardName: string) {
    const res = await fetch("/api/loyalty/redemptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer_id: customerId, reward_id: rewardId }) });
    const data = await res.json();
    if (!res.ok) return toast({ variant: "destructive", title: "Couldn't issue reward", description: data.error });
    setIssuedCode({ code: data.redemption.code, reward_name: rewardName, expires_at: data.redemption.expires_at });
    toast({ variant: "success", title: "Reward code issued", description: rewardName });
    load(); onChange();
  }

  async function toggleConsent(consent: boolean) {
    const res = await fetch(`/api/customers/${customerId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketing_consent: consent }) });
    if (!res.ok) { const data = await res.json(); return toast({ variant: "destructive", title: "Couldn't update consent", description: data.error }); }
    load(); onChange();
  }

  async function sendWinback() {
    if (!winbackRewardId) return;
    setWinbackSending(true);
    try {
      const res = await fetch("/api/loyalty/winback/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer_id: customerId, reward_id: Number(winbackRewardId) }) });
      const data = await res.json();
      if (!res.ok) return toast({ variant: "destructive", title: "Couldn't send win-back offer", description: data.error });
      toast({ variant: "success", title: "Win-back offer sent", description: `Code ${data.code} emailed.` });
      setWinbackRewardId("");
      load(); onChange();
    } finally { setWinbackSending(false); }
  }

  async function adjust() {
    if (!adjustPoints) return;
    const res = await fetch("/api/loyalty/adjust", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer_id: customerId, points_delta: Number(adjustPoints) }) });
    if (!res.ok) {
      const data = await res.json();
      return toast({ variant: "destructive", title: "Couldn't adjust points", description: data.error });
    }
    toast({ variant: "success", title: "Points adjusted", description: `${Number(adjustPoints) > 0 ? "+" : ""}${adjustPoints} points.` });
    setAdjustPoints("");
    load(); onChange();
  }

  if (!detail) return null;
  const c = detail.customer;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-foreground font-bold text-lg">{c.name}</h2>
            <p className="text-muted-foreground text-sm">{c.phone} {c.email && `· ${c.email}`}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`text-sm font-bold ${tierColor[c.tier]}`}>{c.tier}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${segmentStyle[c.segment]}`}>{segmentLabel[c.segment] ?? c.segment}</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-surface-hover p-2"><p className="text-foreground font-bold">{fmtMoney(c.lifetime_spend)}</p><p className="text-muted-foreground text-xs">Lifetime Spend</p></div>
          <div className="rounded-lg bg-surface-hover p-2"><p className="text-foreground font-bold">{c.visit_count}</p><p className="text-muted-foreground text-xs">Visits</p></div>
          <div className="rounded-lg bg-surface-hover p-2"><p className="text-foreground font-bold">{c.loyalty_points}</p><p className="text-muted-foreground text-xs">Points</p></div>
        </div>
        {c.favourite_dish && <p className="mt-2 text-sm text-muted-foreground">⭐ Favourite: {c.favourite_dish}</p>}
        {c.referral_code && <p className="mt-1 text-xs text-muted-foreground">Referral code: <span className="text-red-600">{c.referral_code}</span></p>}
        {c.last_visit && <p className="mt-1 text-xs text-muted-foreground">Last visit: {new Date(c.last_visit).toLocaleDateString("en-GB")}</p>}

        {isManager && (
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={c.marketing_consent} onChange={(e) => toggleConsent(e.target.checked)} />
            Opted in to marketing emails
          </label>
        )}

        {c.segment === "LAPSED" && isManager && (
          <div className="mt-3 rounded-lg border border-orange-300/50 bg-orange-50 p-3">
            <p className="text-orange-800 text-xs font-semibold">This customer hasn&apos;t visited in a while.</p>
            {!c.marketing_consent ? (
              <p className="text-orange-700 text-xs mt-1">Opt them in above to send a win-back offer.</p>
            ) : !c.email ? (
              <p className="text-orange-700 text-xs mt-1">No email on file — can&apos;t send a win-back offer.</p>
            ) : (
              <div className="mt-2 flex gap-2">
                <select value={winbackRewardId} onChange={(e) => setWinbackRewardId(e.target.value)}
                  className="flex-1 bg-surface-hover border border-border rounded-lg px-2 py-1.5 text-foreground text-xs">
                  <option value="">Choose a reward…</option>
                  {rewards.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <button onClick={sendWinback} disabled={!winbackRewardId || winbackSending}
                  className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg">
                  {winbackSending ? "…" : "Send"}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-4">
          <h3 className="text-muted-foreground text-xs font-bold uppercase tracking-widest">Issue a Reward Code</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {/* welcome + Bring a Friend are automatic-only (0 pts — a button would give them away) */}
            {rewards.filter((r) => !r.is_welcome_reward && !r.is_referral_reward).map((r) => (
              <button key={r.id} onClick={() => issueReward(r.id, r.name)} disabled={c.loyalty_points < r.points_cost}
                className="px-3 py-1.5 bg-surface-hover hover:bg-elevated disabled:opacity-40 text-foreground text-xs font-semibold rounded-lg border border-border">
                {r.name} · {r.points_cost}pts
              </button>
            ))}
          </div>
          {issuedCode && (
            <div className="mt-3 rounded-lg border border-emerald-400/50 bg-emerald-50 p-3">
              <p className="text-emerald-800 text-sm font-semibold">{issuedCode.reward_name} — give this code to the customer:</p>
              <p className="text-emerald-900 text-2xl font-black tracking-[0.15em] mt-1">{issuedCode.code}</p>
              <p className="text-emerald-700 text-xs mt-1">Valid until {new Date(issuedCode.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} — enter it at the till to redeem.</p>
            </div>
          )}
        </div>

        {isManager && (
          <div className="mt-4 flex gap-2">
            <input type="number" placeholder="+/- points" value={adjustPoints} onChange={(e) => setAdjustPoints(e.target.value)} className="flex-1 bg-surface-hover border border-border rounded-lg px-3 py-1.5 text-foreground text-sm" />
            <button onClick={adjust} className="px-3 py-1.5 bg-elevated hover:bg-elevated-hover text-foreground text-xs font-bold rounded-lg">Adjust</button>
          </div>
        )}

        <div className="mt-4">
          <h3 className="text-muted-foreground text-xs font-bold uppercase tracking-widest">Order History</h3>
          <div className="mt-2 space-y-1">
            {detail.orders.map((o) => (
              <div key={o.id} className="flex justify-between text-sm"><span className="text-foreground">{o.order_number} · {o.order_type}</span><span className="text-muted-foreground">{fmtMoney(o.total)}</span></div>
            ))}
            {detail.orders.length === 0 && <p className="text-muted-foreground text-sm">No orders yet.</p>}
          </div>
        </div>

        <button onClick={onClose} className="mt-5 w-full h-10 bg-elevated hover:bg-elevated-hover text-foreground font-semibold rounded-xl">Close</button>
      </div>
    </div>
  );
}

export default function CustomersView({ isManager, businessName = "The Royal Chilli" }: { isManager: boolean; businessName?: string }) {
  const [tab, setTab] = useState<"customers" | "feedback" | "report" | "rewards" | "rules" | "tiers" | "redemptions">("customers");
  // A link like /staff/customers?tab=feedback (from Notifications) opens that tab.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "feedback") setTab("feedback");
  }, []);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<Segment | "all">("all");
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [redemptionsDate, setRedemptionsDate] = useState("");
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [modal, setModal] = useState(false);
  const [dupesOpen, setDupesOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [newReward, setNewReward] = useState({ name: "", points_cost: "", discount_amount: "", min_spend: "", valid_days: "7", is_birthday_reward: false });
  const { toast } = useToast();

  const loadCustomers = useCallback(async () => {
    const res = await fetch(`/api/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`);
    const data = await res.json();
    setCustomers(data.customers || []);
  }, [search]);
  const loadRewards = useCallback(async () => {
    const res = await fetch("/api/loyalty/rewards");
    const data = await res.json();
    setRewards(data.rewards || []);
  }, []);
  const loadTiers = useCallback(async () => {
    const res = await fetch("/api/loyalty/tiers");
    const data = await res.json();
    setTiers(data.tiers || []);
  }, []);
  const loadRedemptions = useCallback(async () => {
    const res = await fetch(`/api/loyalty/redemptions/log${redemptionsDate ? `?to=${redemptionsDate}` : ""}`);
    const data = await res.json();
    setRedemptions(data.redemptions || []);
  }, [redemptionsDate]);
  const loadBirthdays = useCallback(async () => {
    const res = await fetch("/api/customers/birthdays");
    const data = await res.json();
    setBirthdays(data.upcomingBirthdays || []);
  }, []);

  useEffect(() => {
    loadCustomers();
    const t = setInterval(loadCustomers, 30000);
    return () => clearInterval(t);
  }, [loadCustomers]);
  useEffect(() => {
    const load = () => { loadRewards(); loadTiers(); loadBirthdays(); };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [loadRewards, loadTiers, loadBirthdays]);
  useEffect(() => {
    if (tab !== "redemptions") return;
    loadRedemptions();
    const t = setInterval(loadRedemptions, 30000);
    return () => clearInterval(t);
  }, [tab, loadRedemptions]);

  async function addReward() {
    if (!newReward.name || !newReward.points_cost) return;
    const res = await fetch("/api/loyalty/rewards", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newReward.name, points_cost: Number(newReward.points_cost),
        discount_amount: newReward.discount_amount || undefined,
        min_spend: newReward.min_spend || undefined,
        valid_days: newReward.valid_days || undefined,
        is_birthday_reward: newReward.is_birthday_reward || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) return toast({ variant: "destructive", title: "Couldn't add reward", description: data.error });
    setNewReward({ name: "", points_cost: "", discount_amount: "", min_spend: "", valid_days: "7", is_birthday_reward: false });
    loadRewards();
  }

  async function toggleRewardActive(reward: Reward & { active?: number }) {
    await fetch(`/api/loyalty/rewards/${reward.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) });
    loadRewards();
  }

  async function updateTier(id: number, field: "min_lifetime_spend" | "points_multiplier", value: string) {
    if (value === "" || isNaN(Number(value))) return;
    const res = await fetch(`/api/loyalty/tiers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: Number(value) }) });
    if (!res.ok) { const data = await res.json(); toast({ variant: "destructive", title: "Couldn't update tier", description: data.error }); }
    loadTiers();
  }

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur px-4 py-4">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-foreground text-[22px] font-semibold tracking-[-0.02em]">Customers & Loyalty</h1>
              <p className="text-muted-foreground text-sm">Customer profiles, loyalty points and repeat-order history.</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1 mt-4 bg-surface-hover p-1 rounded-xl">
            <button onClick={() => setTab("customers")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${tab === "customers" ? "bg-red-500 text-white" : "text-muted-foreground"}`}>Customers</button>
            <button onClick={() => setTab("feedback")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${tab === "feedback" ? "bg-red-500 text-white" : "text-muted-foreground"}`}>Feedback</button>
            <button onClick={() => setTab("report")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${tab === "report" ? "bg-red-500 text-white" : "text-muted-foreground"}`}>Club Report</button>
            <button onClick={() => setTab("rewards")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${tab === "rewards" ? "bg-red-500 text-white" : "text-muted-foreground"}`}>Rewards Catalog</button>
            <button onClick={() => setTab("rules")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${tab === "rules" ? "bg-red-500 text-white" : "text-muted-foreground"}`}>Rewards Rules</button>
            <button onClick={() => setTab("tiers")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${tab === "tiers" ? "bg-red-500 text-white" : "text-muted-foreground"}`}>Tiers</button>
            <button onClick={() => setTab("redemptions")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${tab === "redemptions" ? "bg-red-500 text-white" : "text-muted-foreground"}`}>Redemptions</button>
          </div>
        </div>
      </div>

      <div className="px-4 py-6">
      <div className="mx-auto max-w-4xl">
        {birthdays.length > 0 && (
          <div className="rounded-xl border border-amber-300/50 bg-amber-50 p-3 space-y-1">
            {birthdays.map((b) => (
              <p key={b.id} className="text-amber-700 text-sm">🎂 {b.name} — {b.days_away === 0 ? "today!" : `in ${b.days_away} day${b.days_away > 1 ? "s" : ""}`} ({b.phone})</p>
            ))}
          </div>
        )}

        {tab === "customers" && (
          <div className="mt-5">
            <div className="flex flex-wrap gap-2">
              <input placeholder="Search name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 min-w-[160px] bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
              {isManager && (
                <button onClick={() => setDupesOpen(true)} className="px-3 py-2 border border-border bg-surface hover:bg-surface-hover text-foreground text-sm font-semibold rounded-lg">
                  Possible duplicates
                </button>
              )}
              <button onClick={() => setModal(true)} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg">+ Add</button>
            </div>
            {/* Group counts — tap one to filter the list */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
              <button
                onClick={() => setSegmentFilter("all")}
                className={`rounded-lg border px-2 py-2 text-left ${segmentFilter === "all" ? "border-red-500 ring-1 ring-red-500" : "border-border"} bg-surface`}
              >
                <div className="text-lg font-bold text-foreground">{customers.length}</div>
                <div className="text-[11px] text-muted-foreground">All members</div>
              </button>
              {SEGMENTS.map((sg) => (
                <button
                  key={sg}
                  onClick={() => setSegmentFilter(segmentFilter === sg ? "all" : sg)}
                  title={segmentHint[sg]}
                  className={`rounded-lg border px-2 py-2 text-left ${segmentFilter === sg ? "border-red-500 ring-1 ring-red-500" : "border-border"} bg-surface`}
                >
                  <div className="text-lg font-bold text-foreground">{customers.filter((c) => c.segment === sg).length}</div>
                  <div className="text-[11px] text-muted-foreground">{segmentLabel[sg]}</div>
                  <div className="text-[10px] text-muted-foreground/70">{segmentHint[sg]}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface text-muted-foreground"><tr><th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Phone</th><th className="text-right px-3 py-2">Spend</th><th className="text-right px-3 py-2">Visits</th><th className="text-right px-3 py-2">Points</th><th className="text-right px-3 py-2">Tier</th><th className="text-right px-3 py-2">Group</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {customers.filter((c) => segmentFilter === "all" || c.segment === segmentFilter).map((c) => (
                    <tr key={c.id} onClick={() => setDetailId(c.id)} className="bg-background hover:bg-surface cursor-pointer">
                      <td className="px-3 py-2 text-foreground font-medium">{c.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.phone}</td>
                      <td className="px-3 py-2 text-right text-foreground">{fmtMoney(c.lifetime_spend)}</td>
                      <td className="px-3 py-2 text-right text-foreground">{c.visit_count}</td>
                      <td className="px-3 py-2 text-right text-foreground">{c.loyalty_points}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${tierColor[c.tier]}`}>{c.tier}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${segmentStyle[c.segment]}`}>{segmentLabel[c.segment] ?? c.segment}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {customers.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No customers yet — they'll appear automatically once orders/reservations come in with a phone number.</p>}
            </div>
          </div>
        )}

        {tab === "rewards" && (
          <div className="mt-5">
            {isManager && (
              <div className="rounded-xl border border-border bg-surface p-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <input placeholder="Reward name" value={newReward.name} onChange={(e) => setNewReward({ ...newReward, name: e.target.value })} className="flex-1 min-w-[140px] bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
                  <input type="number" placeholder="Points cost" value={newReward.points_cost} onChange={(e) => setNewReward({ ...newReward, points_cost: e.target.value })} className="w-28 bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <input type="number" placeholder="£ off (optional)" value={newReward.discount_amount} onChange={(e) => setNewReward({ ...newReward, discount_amount: e.target.value })} className="w-32 bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
                  <input type="number" placeholder="Min spend £ (optional)" value={newReward.min_spend} onChange={(e) => setNewReward({ ...newReward, min_spend: e.target.value })} className="w-40 bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
                  <input type="number" placeholder="Valid days" value={newReward.valid_days} onChange={(e) => setNewReward({ ...newReward, valid_days: e.target.value })} className="w-28 bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
                  <button onClick={addReward} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg">+ Add</button>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={newReward.is_birthday_reward} onChange={(e) => setNewReward({ ...newReward, is_birthday_reward: e.target.checked })} />
                  🎂 Auto-issue this to every customer on their birthday (set points cost to 0 for a free gift)
                </label>
                <p className="text-muted-foreground text-xs">Leave &quot;£ off&quot; blank for a comped item (e.g. free dessert) — staff hand it over on a valid code, no automatic price change.</p>
              </div>
            )}
            <div className="mt-3 space-y-2">
              {rewards.map((r) => (
                <div key={r.id} className="rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] px-4 py-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-foreground font-semibold">{r.name} <span className="text-red-600">· {r.points_cost} pts</span> {r.is_birthday_reward && <span className="text-amber-600">🎂</span>}</p>
                    {r.description && <p className="text-muted-foreground text-sm">{r.description}</p>}
                    <p className="text-muted-foreground text-xs mt-1">
                      {r.discount_amount ? `£${Number(r.discount_amount).toFixed(2)} off` : "Comped item"}
                      {r.min_spend > 0 ? ` · min spend £${Number(r.min_spend).toFixed(2)}` : ""}
                      {r.eligible_tier_name ? ` · ${r.eligible_tier_name}+ only` : ""}
                      {` · code valid ${r.valid_days}d`}
                    </p>
                  </div>
                  {isManager && (
                    <button onClick={() => toggleRewardActive(r)} className="flex-shrink-0 text-xs text-muted-foreground hover:text-red-600 font-semibold">Remove</button>
                  )}
                </div>
              ))}
              {rewards.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No rewards in the catalog yet.</p>}
            </div>
          </div>
        )}

        {tab === "feedback" && <FeedbackInbox businessName={businessName} />}

        {tab === "report" && <div className="mt-5"><ClubReport /></div>}

        {tab === "rules" && <RewardsRules canEdit={isManager} />}

        {tab === "tiers" && (
          <div className="mt-5">
            <p className="text-muted-foreground text-sm">Tier is based on lifetime spend and multiplies points earned on every purchase.</p>
            <div className="mt-3 rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface text-muted-foreground"><tr><th className="text-left px-3 py-2">Tier</th><th className="text-right px-3 py-2">Min lifetime spend</th><th className="text-right px-3 py-2">Points multiplier</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {tiers.map((t) => (
                    <tr key={t.id} className="bg-background">
                      <td className={`px-3 py-2 font-semibold ${tierColor[t.name] ?? "text-foreground"}`}>{t.name}</td>
                      <td className="px-3 py-2 text-right">
                        {isManager ? (
                          <input type="number" defaultValue={t.min_lifetime_spend} onBlur={(e) => updateTier(t.id, "min_lifetime_spend", e.target.value)}
                            className="w-24 text-right bg-surface-hover border border-border rounded px-2 py-1 text-foreground" />
                        ) : <>£{t.min_lifetime_spend}</>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isManager ? (
                          <input type="number" step="0.05" defaultValue={t.points_multiplier} onBlur={(e) => updateTier(t.id, "points_multiplier", e.target.value)}
                            className="w-20 text-right bg-surface-hover border border-border rounded px-2 py-1 text-foreground" />
                        ) : <>×{t.points_multiplier}</>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tiers.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No tiers configured.</p>}
            </div>
          </div>
        )}

        {tab === "redemptions" && (
          <div className="mt-5">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-muted-foreground text-xs">Up to date:</label>
              <input type="date" value={redemptionsDate} onChange={(e) => setRedemptionsDate(e.target.value)}
                className="bg-surface-hover border border-border rounded-lg px-3 py-1.5 text-foreground text-sm" />
              {redemptionsDate && (
                <button onClick={() => setRedemptionsDate("")} className="text-xs text-muted-foreground hover:text-red-600 font-semibold">Clear</button>
              )}
            </div>
            <div className="mt-3 rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface text-muted-foreground"><tr><th className="text-left px-3 py-2">Code</th><th className="text-left px-3 py-2">Reward</th><th className="text-left px-3 py-2">Customer</th><th className="text-left px-3 py-2">Status</th><th className="text-right px-3 py-2">Points</th><th className="text-left px-3 py-2">Issued</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {redemptions.map((r) => (
                    <tr key={r.id} className="bg-background">
                      <td className="px-3 py-2 font-mono text-foreground">{r.code}</td>
                      <td className="px-3 py-2 text-foreground">{r.reward?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.customer?.name ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={
                          r.status === "redeemed" ? "text-emerald-600 font-semibold" :
                          r.status === "issued" ? "text-blue-600 font-semibold" :
                          "text-muted-foreground"
                        }>{r.status}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-foreground">{r.points_spent}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(r.issued_at).toLocaleDateString("en-GB")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {redemptions.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No redemptions yet.</p>}
            </div>
          </div>
        )}
      </div>

      {modal && <AddCustomerModal onClose={() => setModal(false)} onSaved={loadCustomers} />}
      {dupesOpen && <DuplicatesPanel onClose={() => setDupesOpen(false)} onMerged={loadCustomers} />}
      {detailId && <CustomerDetailModal customerId={detailId} rewards={rewards} isManager={isManager} onClose={() => setDetailId(null)} onChange={loadCustomers} />}
      </div>
    </>
  );
}
