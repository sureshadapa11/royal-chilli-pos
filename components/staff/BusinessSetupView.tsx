"use client";

import { useCallback, useEffect, useState } from "react";
import { SECRET_FIELDS, SECTIONS, addressOneLine, type Address, type FieldDef, type SectionDef } from "@/lib/business-setup";

type Business = Record<string, unknown> & { id: number; name: string; modules?: Record<string, boolean> };
type Private = Record<string, unknown> & { connected: Record<string, boolean> };
type Loaded = { business: Business; private: Private | null; owner: boolean; secretsReady: boolean };

const card = "rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-5";
const input = "w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm";
const ADDRESS_PARTS: { key: keyof Address; label: string }[] = [
  { key: "line1", label: "Address line 1" }, { key: "line2", label: "Address line 2" },
  { key: "city", label: "Town / city" }, { key: "county", label: "County" }, { key: "postcode", label: "Postcode" },
];

// Staff Hub → Settings → Business setup: this business's details, one section
// at a time. The rules (fields, formats, who may edit) are in lib/business-setup.ts.
export default function BusinessSetupView() {
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/business-setup");
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setLoadError(d.error || "Couldn't load the business setup");
    setData(d);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loadError) return <p className="py-6 text-sm text-red-600">{loadError}</p>;
  if (!data) return <p className="py-6 text-sm text-muted-foreground">Loading business setup…</p>;

  // Bank details and payment keys are the owner's alone; other owner-only
  // sections are shown read-only to the business's admin.
  const visible = SECTIONS.filter((s) => !(s.private && !data.owner));
  return (
    <div className="space-y-5">
      {visible.map((s) => (
        <Section key={s.key} def={s} data={data} onSaved={load} />
      ))}
    </div>
  );
}

function currentValue(def: SectionDef, f: FieldDef, data: Loaded): unknown {
  if (def.key === "modules") return data.business.modules?.[f.key.replace(/^modules\./, "")] ?? false;
  if (def.private) return SECRET_FIELDS.has(f.key) ? "" : (data.private?.[f.key] ?? "");
  const v = data.business[f.key];
  if (f.kind === "address") return (v as Address | null) ?? {};
  if (f.kind === "bool") return !!v;
  return v ?? "";
}

function Section({ def, data, onSaved }: { def: SectionDef; data: Loaded; onSaved: () => void }) {
  const canEdit = !def.ownerOnly || data.owner;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function start() {
    setForm(Object.fromEntries(def.fields.map((f) => [f.key, currentValue(def, f, data)])));
    setErrors({});
    setMessage("");
    setEditing(true);
  }

  async function save(overrides?: Record<string, unknown>) {
    setSaving(true);
    setMessage("");
    const res = await fetch("/api/business-setup", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: def.key, values: overrides ?? form }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setErrors(d.fields ?? {});
      setMessage(d.error || "Couldn't save");
      return;
    }
    setEditing(false);
    setErrors({});
    setMessage("Saved");
    onSaved();
  }

  const set = (key: string, v: unknown) => setForm((f) => ({ ...f, [key]: v }));

  return (
    <section className={card} aria-labelledby={`setup-${def.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`setup-${def.key}`} className="text-lg font-bold text-foreground">
            {def.title}
            {def.ownerOnly && <span className="ml-2 rounded bg-surface-hover px-1.5 py-0.5 align-middle text-[11px] font-semibold text-muted-foreground">Owner only</span>}
          </h2>
          <p className="mt-1 max-w-[70ch] text-xs text-muted-foreground">{def.about}</p>
        </div>
        {canEdit && !editing && (
          <button type="button" onClick={start} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-hover">Edit</button>
        )}
      </div>

      {def.key === "payments" && !data.secretsReady && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Payment keys can&apos;t be saved yet: the encryption key (SETTINGS_ENCRYPTION_KEY) still needs adding to the hosting settings.
        </p>
      )}

      {!editing ? (
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {def.fields.map((f) => (
            <div key={f.key} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="mt-0.5 break-words text-sm text-foreground">{display(def, f, data)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => { e.preventDefault(); save(); }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {def.fields.map((f) => (
              <Field key={f.key} def={def} f={f} value={form[f.key]} error={errors[f.key]} onChange={(v) => set(f.key, v)}
                connected={def.private ? data.private?.connected?.[f.key] : undefined}
                onDisconnect={() => save({ [f.key]: null })} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="submit" disabled={saving} className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => { setEditing(false); setErrors({}); setMessage(""); }} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-surface-hover">Cancel</button>
            {message && <span className={`text-sm ${Object.keys(errors).length || message !== "Saved" ? "text-red-600" : "text-emerald-600"}`}>{message}</span>}
          </div>
        </form>
      )}
      {!editing && message === "Saved" && <p className="mt-3 text-sm font-semibold text-emerald-600">✓ Saved</p>}
    </section>
  );
}

function display(def: SectionDef, f: FieldDef, data: Loaded): string {
  if (def.private && SECRET_FIELDS.has(f.key)) return data.private?.connected?.[f.key] ? "Connected ✓" : "Not connected";
  const v = currentValue(def, f, data);
  if (f.kind === "bool") return v ? "Yes" : "No";
  if (f.kind === "address") return addressOneLine(v as Address) || "—";
  if (f.kind === "rate") return v === "" ? "—" : `${Math.round(Number(v) * 10000) / 100}%`;
  if (f.kind === "textarea") {
    const s = String(v || "");
    return s ? (s.length > 140 ? `${s.slice(0, 140)}…` : s) : "—";
  }
  return String(v || "—");
}

function Field({
  def, f, value, error, onChange, connected, onDisconnect,
}: {
  def: SectionDef; f: FieldDef; value: unknown; error?: string; onChange: (v: unknown) => void;
  connected?: boolean; onDisconnect: () => void;
}) {
  const id = `setup-${def.key}-${f.key}`;
  const err = error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null;
  const hint = f.hint ? <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p> : null;

  if (f.kind === "bool") {
    return (
      <label htmlFor={id} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground">
        <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-red-600" />
        {f.label}
        {err}
      </label>
    );
  }
  if (f.kind === "address") {
    const a = (value ?? {}) as Address;
    return (
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-xs text-muted-foreground">{f.label}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ADDRESS_PARTS.map((p) => (
            <input key={p.key} id={`${id}-${p.key}`} aria-label={`${f.label}: ${p.label}`} placeholder={p.label} value={a[p.key] ?? ""}
              onChange={(e) => onChange({ ...a, [p.key]: e.target.value })} className={input} />
          ))}
        </div>
        {err}
      </fieldset>
    );
  }
  if (f.kind === "textarea") {
    const long = def.key === "legal";
    return (
      <div className={long ? "sm:col-span-2" : ""}>
        <label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">{f.label}</label>
        <textarea id={id} rows={long ? 8 : 3} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={input} />
        {hint}{err}
      </div>
    );
  }
  const secret = def.private && SECRET_FIELDS.has(f.key);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">{f.label}</label>
      <input
        id={id}
        type={f.kind === "email" ? "email" : f.kind === "url" ? "url" : secret ? "password" : "text"}
        // Never let Chrome put a saved login into a key or setting.
        autoComplete={secret ? "new-password" : "off"}
        value={String(value ?? "")}
        placeholder={secret && connected ? "Connected — leave empty to keep it" : ""}
        onChange={(e) => onChange(e.target.value)}
        className={input}
      />
      {secret && connected && (
        <button type="button" onClick={onDisconnect} className="mt-1 text-xs font-semibold text-red-600 hover:underline">Disconnect</button>
      )}
      {hint}{err}
    </div>
  );
}
