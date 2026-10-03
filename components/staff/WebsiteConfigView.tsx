"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EMPTY_WEBSITE_CONFIG, LIMITS, SEO_RECOMMENDED, orderingStatus,
  type WebsiteConfig,
} from "@/lib/website-config";

type Modules = {
  website: boolean; online_ordering: boolean; qr_ordering: boolean;
  delivery: boolean; delivery_platforms: boolean; reservations: boolean;
};
type Loaded = {
  business: { id: number; name: string; tagline: string | null; logo_url: string | null; domain: string | null };
  config: WebsiteConfig;
  modules: Modules;
  canToggleOrdering: boolean;
  version: number;
};

const heading = { fontFamily: "var(--font-space-grotesk)" };
const card = "mt-5 rounded-[14px] border border-border bg-surface p-4 md:p-5";
const input = "w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm";
const label = "mb-1 block text-xs text-muted-foreground";

type SaveState = { saving: boolean; message: string; ok: boolean; fields: Record<string, string> };
const idle: SaveState = { saving: false, message: "", ok: false, fields: {} };

const NETWORK_ERROR = "Couldn't reach the server — check your connection and try again";

async function send(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch("/api/website/config", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

async function fetchConfig(): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch("/api/website/config");
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

// Staff Hub → Operations → Website: the editable parts (homepage content,
// SEO & social, online ordering). Rules and limits: lib/website-config.ts.
export default function WebsiteConfigView() {
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      const { ok, data: d } = await fetchConfig();
      if (!ok) return setLoadError(String(d.error || "Couldn't load the website settings"));
      setData(d as unknown as Loaded);
    } catch {
      setLoadError(NETWORK_ERROR);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loadError) return <p className="mt-5 text-sm text-red-600">{loadError}</p>;
  if (!data) return <p className="mt-5 text-sm text-muted-foreground">Loading website settings…</p>;

  return (
    <>
      <OrderingCard data={data} onSaved={setData} />
      <SeoCard data={data} onSaved={setData} />
    </>
  );
}

// Each save carries the version it was based on. If someone else saved first
// (409), fetch the latest version and send this card's change once more — the
// server merges it in, so other cards' changes are kept.
function useSave(onSaved: (d: Loaded) => void, version: number) {
  const [state, setState] = useState<SaveState>(idle);
  const save = async (body: Record<string, unknown>) => {
    setState({ ...idle, saving: true });
    let result: SaveState = { ...idle, message: NETWORK_ERROR };
    try {
      let { ok, status, data } = await send({ ...body, version });
      if (status === 409) {
        const fresh = await fetchConfig();
        if (fresh.ok) {
          ({ ok, status, data } = await send({ ...body, version: (fresh.data as unknown as Loaded).version }));
          if (!ok) onSaved(fresh.data as unknown as Loaded);
        }
      }
      if (!ok) {
        result = { ...idle, message: String(data.error || "Couldn't save"), fields: (data.fields as Record<string, string>) ?? {} };
        return false;
      }
      result = { ...idle, ok: true, message: "Saved" };
      onSaved(data as unknown as Loaded);
      return true;
    } catch {
      return false;
    } finally {
      setState({ ...result, saving: false });
    }
  };
  return { state, save };
}

function SaveRow({ state }: { state: SaveState }) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      <button type="submit" disabled={state.saving} className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-60">
        {state.saving ? "Saving…" : "Save"}
      </button>
      {state.message && (
        <span role="status" className={`text-sm font-semibold ${state.ok ? "text-emerald-600" : "text-red-600"}`}>
          {state.ok ? "✓ Saved" : state.message}
        </span>
      )}
    </div>
  );
}

const FieldError = ({ msg }: { msg?: string }) => (msg ? <p className="mt-1 text-xs text-red-600">{msg}</p> : null);

/** "48 / 60" — amber from 90% of the recommended length, red past it. */
function Counter({ value, max, recommended }: { value: string; max: number; recommended?: string }) {
  const n = value.length;
  const colour = n > max ? "text-red-600" : n >= max * 0.9 ? "text-amber-600" : "text-muted-foreground";
  return (
    <p className={`mt-1 text-right text-xs ${colour}`} aria-live="polite">
      {n} / {max}{recommended ? ` · ${recommended}` : ""}
    </p>
  );
}

function SectionTitle({ id, title, badge }: { id: string; title: string; badge?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <h2 id={id} style={heading} className="text-[17px] font-semibold text-foreground">{title}</h2>
      {badge}
    </div>
  );
}

// ── Online ordering ─────────────────────────────────────────────────────────

const STATUS = {
  live: { text: "Live", cls: "bg-green-600/10 text-green-700" },
  coming_soon: { text: "Coming soon", cls: "bg-amber-500/10 text-amber-700" },
  off: { text: "Off", cls: "bg-muted text-muted-foreground" },
} as const;

function OrderingCard({ data, onSaved }: { data: Loaded; onSaved: (d: Loaded) => void }) {
  const { state, save } = useSave(onSaved, data.version);
  const status = orderingStatus(data.modules.online_ordering, data.config.ordering_coming_soon);
  const channels = [
    { on: data.modules.online_ordering, text: "Website orders (collection & delivery)" },
    { on: data.modules.qr_ordering, text: "QR table ordering" },
    { on: data.modules.delivery, text: "Own delivery drivers" },
    { on: data.modules.delivery_platforms, text: "Delivery platforms (Just Eat, Uber Eats, Deliveroo, Hiest)" },
  ].filter((c) => c.on);

  return (
    <section className={card} aria-labelledby="website-ordering">
      <SectionTitle
        id="website-ordering"
        title="Online ordering"
        badge={<span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${STATUS[status].cls}`}>{STATUS[status].text}</span>}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground">
          <input
            type="checkbox" className="h-4 w-4 accent-red-600"
            checked={data.modules.online_ordering} disabled={!data.canToggleOrdering || state.saving}
            onChange={(e) => save({ online_ordering: e.target.checked })}
          />
          Take orders on the website
        </label>
        <label className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground">
          <input
            type="checkbox" className="h-4 w-4 accent-red-600"
            checked={data.config.ordering_coming_soon} disabled={data.modules.online_ordering || state.saving}
            onChange={(e) => save({ config: { ordering_coming_soon: e.target.checked } })}
          />
          Say &ldquo;coming soon&rdquo; while ordering is off
        </label>
      </div>
      {!data.canToggleOrdering && (
        <p className="mt-2 text-xs text-muted-foreground">Only the owner can switch online ordering on or off.</p>
      )}
      {status === "live" && (
        <div className="mt-4">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Connected</p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {channels.map((c) => (
              <li key={c.text} className="rounded-full border border-border bg-surface-hover px-2.5 py-1 text-[12.5px] text-foreground">{c.text}</li>
            ))}
          </ul>
        </div>
      )}
      {state.message && (
        <p role="status" className={`mt-3 text-sm font-semibold ${state.ok ? "text-emerald-600" : "text-red-600"}`}>
          {state.ok ? "✓ Saved" : state.message}
        </p>
      )}
    </section>
  );
}

// ── SEO & social ────────────────────────────────────────────────────────────

function SeoCard({ data, onSaved }: { data: Loaded; onSaved: (d: Loaded) => void }) {
  const { state, save } = useSave(onSaved, data.version);
  const [form, setForm] = useState(() => ({
    ...pick(data.config, ["seo_title", "seo_description", "og_image_url"]),
    social_links: { ...data.config.social_links },
  }));
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setSocial = (k: keyof WebsiteConfig["social_links"], v: string) =>
    setForm((f) => ({ ...f, social_links: { ...f.social_links, [k]: v } }));
  const { seo_title: t, seo_description: d } = SEO_RECOMMENDED;

  return (
    <section className={card} aria-labelledby="website-seo">
      <SectionTitle id="website-seo" title="SEO & social media" />
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save({ config: form }); }}>
        <div>
          <label htmlFor="wc-title" className={label}>Page title (shown in Google results)</label>
          <input id="wc-title" className={input} maxLength={LIMITS.seo_title} placeholder={data.business.name}
            value={form.seo_title} onChange={(e) => set("seo_title", e.target.value)} />
          <Counter value={form.seo_title} max={t.max} recommended={`${t.min}–${t.max} recommended`} />
          <FieldError msg={state.fields.seo_title} />
        </div>
        <div>
          <label htmlFor="wc-desc" className={label}>Meta description (the snippet under the title)</label>
          <textarea id="wc-desc" rows={3} className={input} maxLength={LIMITS.seo_description}
            value={form.seo_description} onChange={(e) => set("seo_description", e.target.value)} />
          <Counter value={form.seo_description} max={d.max} recommended={`${d.min}–${d.max} recommended`} />
          <FieldError msg={state.fields.seo_description} />
        </div>

        <GooglePreview
          title={form.seo_title || data.business.name}
          url={data.business.domain || "your-website.com"}
          description={form.seo_description || data.config.about || data.business.tagline || ""}
        />

        <div>
          <label htmlFor="wc-og" className={label}>Social-sharing image (link)</label>
          <div className="flex flex-wrap gap-2">
            <input id="wc-og" type="url" className={`${input} min-w-0 flex-1`} placeholder="https://…"
              value={form.og_image_url} onChange={(e) => set("og_image_url", e.target.value)} />
            {data.business.logo_url && (
              <button type="button" onClick={() => set("og_image_url", data.business.logo_url!)}
                className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-surface-hover">
                Use logo
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Shown when someone shares your website on WhatsApp, Facebook and similar. Photo uploads are coming with Menu &amp; photos.</p>
          <FieldError msg={state.fields.og_image_url} />
          {/^https?:\/\//i.test(form.og_image_url) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.og_image_url} alt="Social-sharing preview" className="mt-2 h-24 rounded-lg border border-border object-cover" />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ["instagram", "Instagram", "https://instagram.com/…"],
            ["facebook", "Facebook", "https://facebook.com/…"],
            ["whatsapp", "WhatsApp", "+44 7… or https://wa.me/…"],
          ] as const).map(([k, name, ph]) => (
            <div key={k}>
              <label htmlFor={`wc-${k}`} className={label}>{name}</label>
              <input id={`wc-${k}`} className={input} placeholder={ph} value={form.social_links[k]} onChange={(e) => setSocial(k, e.target.value)} />
              <FieldError msg={state.fields[`social_links.${k}`]} />
            </div>
          ))}
        </div>
        <SaveRow state={state} />
      </form>
    </section>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function GooglePreview({ title, url, description }: { title: string; url: string; description: string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3" aria-label="Google search preview">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Google preview</p>
      <p className="truncate text-[12.5px] text-[#202124]">{url.replace(/^https?:\/\//i, "")}</p>
      <p className="truncate text-[18px] leading-snug text-[#1a0dab]">{clip(title, SEO_RECOMMENDED.seo_title.max)}</p>
      <p className="text-[13px] leading-snug text-[#4d5156]">{clip(description, SEO_RECOMMENDED.seo_description.max) || "Add a meta description so Google shows your own words here."}</p>
    </div>
  );
}

function pick<K extends keyof WebsiteConfig>(c: WebsiteConfig, keys: K[]): Pick<WebsiteConfig, K> {
  const src = { ...EMPTY_WEBSITE_CONFIG, ...c };
  return Object.fromEntries(keys.map((k) => [k, src[k]])) as Pick<WebsiteConfig, K>;
}
