"use client";

import { useEffect, useState } from "react";
import { confirmDelete } from "@/components/ui/confirm";

type Matrix = Record<string, Record<string, boolean>>;
const FIXED = new Set(["admin", "employee", "kitchen"]); // Super admin always on; Front House and Kitchen always off

function PermissionsPanel({ canEdit }: { canEdit: boolean }) {
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [tabLabels, setTabLabels] = useState<Record<string, string>>({});
  const [roleLabels, setRoleLabels] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function load() {
    fetch("/api/permissions").then((r) => r.json()).then((d) => {
      setMatrix(d.matrix);
      setRoles(d.roles || []);
      setTabs(d.tabs || []);
      setTabLabels(d.tabLabels || {});
      setRoleLabels(d.roleLabels || {});
    });
  }

  useEffect(() => { load(); }, []);

  async function toggle(role: string, tab: string, current: boolean) {
    if (!canEdit || FIXED.has(role)) return;
    const cellKey = `${role}:${tab}`;
    setSaving(cellKey);
    setMatrix((m) => (m ? { ...m, [tab]: { ...m[tab], [role]: !current } } : m));
    const res = await fetch("/api/permissions", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, permission: tab, granted: !current }),
    });
    if (!res.ok) setMatrix((m) => (m ? { ...m, [tab]: { ...m[tab], [role]: current } } : m));
    setSaving(null);
  }

  if (!matrix) return <div className="text-muted-foreground text-sm py-6">Loading permissions…</div>;

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-5">
      <h2 className="text-foreground font-bold text-lg">Roles &amp; Permissions</h2>
      <p className="mt-1 text-muted-foreground text-xs">
        Which roles can open each Staff Hub tab. Super admin always has everything; Front House and Kitchen never see Staff Hub — those aren't editable.
        {!canEdit && " Only an Admin can change this."}
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left text-muted-foreground font-semibold p-2 sticky left-0 bg-surface">Tab</th>
              {roles.map((role) => (
                <th key={role} className="text-muted-foreground font-semibold p-2 text-center whitespace-nowrap">
                  {roleLabels[role] || role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tabs.map((tab) => (
              <tr key={tab} className="border-t border-border">
                <td className="p-2 text-foreground sticky left-0 bg-surface max-w-[220px]">{tabLabels[tab] || tab}</td>
                {roles.map((role) => {
                  const granted = matrix[tab]?.[role] ?? false;
                  const fixed = FIXED.has(role);
                  const cellKey = `${role}:${tab}`;
                  return (
                    <td key={role} className="p-2 text-center">
                      <button
                        disabled={!canEdit || fixed || saving === cellKey}
                        onClick={() => toggle(role, tab, granted)}
                        className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors ${
                          granted ? "bg-red-600 border-red-500 text-white" : "bg-surface-hover border-border text-transparent"
                        } ${!canEdit || fixed ? "opacity-60 cursor-not-allowed" : "hover:border-red-500 cursor-pointer"}`}
                        title={fixed ? `${roleLabels[role]} access is fixed` : undefined}
                      >
                        {granted ? "✓" : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 3000); }}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg"
          >
            Save Permissions
          </button>
          {saved && <span className="text-emerald-600 text-sm font-semibold">✓ Saved</span>}
          <span className="text-muted-foreground text-xs">Each toggle above saves the instant you click it — this just confirms everything's up to date.</span>
        </div>
      )}
    </div>
  );
}

function PromotionPanel() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/promotions/current").then((r) => r.json()).then((d) => {
      const p = d.promotion;
      if (p) {
        setTitle(p.title ?? "");
        setDescription(p.description ?? "");
        setLinkUrl(p.link_url ?? "");
        setActive(!!p.active);
      }
      setLoading(false);
    });
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    const res = await fetch("/api/promotions/current", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description, link_url: linkUrl, active }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error || "Failed to save"); return; }
    setSaved(true);
  }

  if (loading) return <div className="text-muted-foreground text-sm py-6">Loading promotion…</div>;

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-5">
      <h2 className="text-foreground font-bold text-lg">Promotion Banner</h2>
      <p className="mt-1 text-muted-foreground text-xs">
        A thin announcement strip shown above the header on every public page (hidden on /account). Only shows when
        turned on below.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Title</label>
          <input
            placeholder="e.g. 20% Off Weekday Lunches" value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Description (optional)</label>
          <input
            placeholder="Short supporting text" value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Link (optional)</label>
          <input
            placeholder="/order or https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
          />
        </div>
        <div className="flex items-center justify-between pt-1">
          <div>
            <p className="text-foreground text-sm font-medium">Show on site</p>
            <p className="text-muted-foreground text-xs">Off means the banner is hidden, even if filled in.</p>
          </div>
          <button
            type="button"
            onClick={() => setActive((v) => !v)}
            className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${active ? "bg-red-600" : "bg-elevated"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${active ? "translate-x-6" : ""}`} />
          </button>
        </div>
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <button
          onClick={save} disabled={saving || !title.trim()}
          className="w-full py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold rounded-lg"
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Promotion"}
        </button>
      </div>
    </div>
  );
}

type MenuItemOption = { id: number; name: string; price: number; category_name: string | null };
type FeaturedDish = {
  id: number; image_url: string; blurb: string | null; position: number; menu_item_id: number;
  menu_items: { name: string; price: number } | null;
};

function FeaturedDishesPanel() {
  const [dishes, setDishes] = useState<FeaturedDish[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  function load() {
    Promise.all([
      fetch("/api/featured-dishes").then((r) => r.json()),
      fetch("/api/menu-items").then((r) => r.json()),
    ]).then(([d, m]) => {
      setDishes(d.dishes || []);
      setMenuItems((m.items || []).map((i: { id: number; name: string; price: number; category_name: string | null }) => ({ id: i.id, name: i.name, price: i.price, category_name: i.category_name })));
      setLoading(false);
    });
  }
  useEffect(() => { load(); }, []);

  async function addDish(file: File) {
    if (!selectedItemId) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "dishes");
      const uploadRes = await fetch("/api/site-content/upload", { method: "POST", body: form });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) { setError(uploadData.error || "Upload failed"); return; }

      const addRes = await fetch("/api/featured-dishes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menu_item_id: selectedItemId, image_url: uploadData.url }),
      });
      if (!addRes.ok) { setError("Failed to add dish"); return; }
      setSelectedItemId(null);
      setSearch("");
      load();
    } finally {
      setUploading(false);
    }
  }

  async function updateBlurb(id: number, blurb: string) {
    setDishes((prev) => prev.map((d) => d.id === id ? { ...d, blurb } : d));
    await fetch(`/api/featured-dishes/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blurb }),
    });
  }

  async function removeDish(id: number) {
    if (!(await confirmDelete("this featured dish", "It will be removed from the website's featured list. Are you sure you want to proceed?"))) return;
    setDishes((prev) => prev.filter((d) => d.id !== id));
    await fetch(`/api/featured-dishes/${id}`, { method: "DELETE" });
  }

  async function moveDish(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= dishes.length) return;
    const reordered = [...dishes];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setDishes(reordered);
    await Promise.all(reordered.map((d, i) => fetch(`/api/featured-dishes/${d.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ position: i }),
    })));
  }

  const filteredItems = search.trim()
    ? menuItems.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8)
    : [];

  if (loading) return <div className="text-muted-foreground text-sm py-6">Loading featured dishes…</div>;

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-5">
      <h2 className="text-foreground font-bold text-lg">Most Popular Dishes (homepage)</h2>
      <p className="mt-1 text-muted-foreground text-xs">
        Real dishes from your menu, with name and price pulled automatically. While this list is empty, the homepage
        shows the original poster-style images instead.
      </p>

      <div className="mt-4 space-y-2">
        {dishes.map((d, i) => (
          <div key={d.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface-hover p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary uploaded URL */}
            <img src={d.image_url} alt="" className="h-14 w-14 flex-shrink-0 rounded-md object-cover" />
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-sm font-semibold truncate">{d.menu_items?.name}</p>
              <p className="text-muted-foreground text-xs">£{Number(d.menu_items?.price ?? 0).toFixed(2)}</p>
              <input
                placeholder="Optional short blurb" defaultValue={d.blurb ?? ""}
                onBlur={(e) => updateBlurb(d.id, e.target.value)}
                className="mt-1 w-full bg-background border border-border rounded px-2 py-1 text-foreground text-xs"
              />
            </div>
            <div className="flex flex-shrink-0 flex-col gap-1">
              <button type="button" disabled={i === 0} onClick={() => moveDish(i, -1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30 text-xs">▲</button>
              <button type="button" disabled={i === dishes.length - 1} onClick={() => moveDish(i, 1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30 text-xs">▼</button>
            </div>
            <button type="button" onClick={() => removeDish(d.id)} className="flex-shrink-0 text-muted-foreground hover:text-red-600 text-xs">Remove</button>
          </div>
        ))}
        {dishes.length === 0 && <p className="text-muted-foreground text-xs">No featured dishes yet.</p>}
      </div>

      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-xs font-semibold text-foreground">Add a dish</p>
        <div className="relative mt-1.5">
          <input
            placeholder="Search menu items…" value={selectedItemId ? menuItems.find((i) => i.id === selectedItemId)?.name ?? "" : search}
            onChange={(e) => { setSearch(e.target.value); setSelectedItemId(null); }}
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
          />
          {filteredItems.length > 0 && !selectedItemId && (
            <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
              {filteredItems.map((i) => (
                <button
                  key={i.id} type="button"
                  onClick={() => { setSelectedItemId(i.id); setSearch(i.name); }}
                  className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-hover"
                >
                  {i.name} <span className="text-muted-foreground text-xs">· £{Number(i.price).toFixed(2)}{i.category_name ? ` · ${i.category_name}` : ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <label className={`mt-2 flex w-fit items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs ${selectedItemId ? "cursor-pointer text-muted-foreground hover:border-red-400 hover:text-red-600" : "cursor-not-allowed text-muted-foreground/50"}`}>
          {uploading ? "Uploading…" : "+ Upload photo & add"}
          <input
            type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={!selectedItemId || uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) addDish(f); e.target.value = ""; }}
          />
        </label>
        {error && <p className="mt-1 text-red-600 text-xs">{error}</p>}
        <p className="mt-1 text-muted-foreground text-xs">Pick a menu item above, then upload its photo to add it to the homepage.</p>
      </div>
    </div>
  );
}

// Settings → General and Settings → Roles & Permissions (the page's tabs are
// in app/staff/settings/page.tsx).
const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function SettingsView({ section, canEditPermissions }: { section: "general" | "permissions"; canEditPermissions: boolean }) {
  const [weekStartDay, setWeekStartDay] = useState("Monday");
  const [overtimeEnabled, setOvertimeEnabled] = useState(false);
  const [maxEmployees, setMaxEmployees] = useState("20");
  const [depositAmount, setDepositAmount] = useState("0");
  const [openingHours, setOpeningHours] = useState<{ day: string; open: string; close: string }[]>([]);
  const [aboutExcerpt, setAboutExcerpt] = useState({ title: "", titleGold: "", text1: "", text2: "" });
  const [storyParagraphs, setStoryParagraphs] = useState<string[]>([]);
  const [heroContent, setHeroContent] = useState({ tag: "", headline: "", headlineGold: "", description: "" });
  const [heroImages, setHeroImages] = useState<string[]>([]);
  const [uploadingHero, setUploadingHero] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [readerId, setReaderId] = useState("");
  const [googleReviewUrl, setGoogleReviewUrl] = useState("");
  const [sumupReaderId, setSumupReaderId] = useState("");
  const [tillProvider, setTillProvider] = useState<"sumup" | "stripe" | "none">("none");
  const [regCode, setRegCode] = useState("");
  const [readerName, setReaderName] = useState("Reception");
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState("");
  const [pairedStatus, setPairedStatus] = useState("");
  const [geofenceEnabled, setGeofenceEnabled] = useState(false);
  const [restaurantLat, setRestaurantLat] = useState("");
  const [restaurantLng, setRestaurantLng] = useState("");
  const [geofenceRadius, setGeofenceRadius] = useState("150");
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        const s = d.settings || {};
        if (s.week_start_day) setWeekStartDay(s.week_start_day);
        setOvertimeEnabled(!!s.overtime_enabled);
        if (s.max_employees !== undefined) setMaxEmployees(String(s.max_employees));
        if (s.reservation_deposit_amount !== undefined) setDepositAmount(String(s.reservation_deposit_amount));
        // Always all seven days — a new business has none saved yet.
        const saved = Array.isArray(s.opening_hours) ? (s.opening_hours as { day: string; open: string; close: string }[]) : [];
        setOpeningHours(WEEK.map((day) => saved.find((h) => h.day === day) ?? { day, open: "", close: "" }));
        if (s.about_excerpt) setAboutExcerpt(s.about_excerpt);
        if (Array.isArray(s.our_story_paragraphs)) setStoryParagraphs(s.our_story_paragraphs);
        if (s.hero_content) setHeroContent(s.hero_content);
        if (Array.isArray(s.hero_images)) setHeroImages(s.hero_images);
        if (s.stripe_terminal_reader_id !== undefined) setReaderId(String(s.stripe_terminal_reader_id));
        if (typeof s.google_review_url === "string") setGoogleReviewUrl(s.google_review_url);
        if (s.sumup_reader_id !== undefined) setSumupReaderId(String(s.sumup_reader_id));
        // Same default as lib/till-reader.ts: before this setting existed, a
        // Stripe reader id alone meant Stripe.
        if (s.till_card_provider === "sumup" || s.till_card_provider === "stripe" || s.till_card_provider === "none") setTillProvider(s.till_card_provider);
        else if (String(s.stripe_terminal_reader_id || "").trim()) setTillProvider("stripe");
        setGeofenceEnabled(!!s.geofence_enabled);
        if (s.restaurant_latitude != null) setRestaurantLat(String(s.restaurant_latitude));
        if (s.restaurant_longitude != null) setRestaurantLng(String(s.restaurant_longitude));
        if (s.geofence_radius_meters !== undefined) setGeofenceRadius(String(s.geofence_radius_meters));
      })
      .finally(() => setLoading(false));
  }, []);

  function useCurrentLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setRestaurantLat(pos.coords.latitude.toFixed(6));
        setRestaurantLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function uploadHeroImage(file: File) {
    setUploadingHero(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/site-content/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) { setUploadError(data.error || "Upload failed"); return; }
      setHeroImages((prev) => [...prev, data.url]);
    } finally {
      setUploadingHero(false);
    }
  }

  async function pairReader() {
    setPairing(true);
    setPairError("");
    setPairedStatus("");
    try {
      const res = await fetch("/api/pos/terminal/pair", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: tillProvider, registration_code: regCode.trim(), label: readerName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setPairError(data.error || "Failed to pair reader"); return; }
      if (tillProvider === "sumup") setSumupReaderId(data.reader.id);
      else setReaderId(data.reader.id);
      setPairedStatus(`Paired — status: ${data.reader.status ?? "registered"}. Click Save below to store it.`);
      setRegCode("");
    } finally {
      setPairing(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    await fetch("/api/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        week_start_day: weekStartDay, overtime_enabled: overtimeEnabled,
        max_employees: Number(maxEmployees),
        reservation_deposit_amount: Number(depositAmount),
        // A day left blank is closed — not listed on the website.
        opening_hours: openingHours.filter((h) => h.open && h.close),
        about_excerpt: aboutExcerpt,
        our_story_paragraphs: storyParagraphs,
        hero_content: heroContent,
        hero_images: heroImages,
        stripe_terminal_reader_id: readerId.trim(),
        sumup_reader_id: sumupReaderId.trim(),
        google_review_url: googleReviewUrl.trim(),
        till_card_provider: tillProvider,
        geofence_enabled: geofenceEnabled,
        restaurant_latitude: restaurantLat ? Number(restaurantLat) : null,
        restaurant_longitude: restaurantLng ? Number(restaurantLng) : null,
        geofence_radius_meters: Number(geofenceRadius) || 150,
      }),
    });
    setSaving(false);
    setSaved(true);
  }

  if (loading) return <div className="py-16 text-center text-muted-foreground">Loading…</div>;

  if (section === "permissions") return <PermissionsPanel canEdit={canEditPermissions} />;

  // General — grouped into cards; one Save for all of them (the featured
  // dishes and promotion banner save on their own, as before).
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card icon="🕐" title="Opening hours" hint="When the website takes orders and bookings, and what it shows in the footer, homepage and FAQ. Until hours are set, online ordering stays closed.">
              <div className="space-y-1.5">
                {openingHours.map((h, i) => (
                  <div key={h.day} className="flex items-center gap-2">
                    <span className="w-24 flex-shrink-0 text-xs text-muted-foreground">{h.day}</span>
                    <input
                      type="time" value={h.open}
                      onChange={(e) => setOpeningHours((prev) => prev.map((d, j) => j === i ? { ...d, open: e.target.value } : d))}
                      className="flex-1 bg-surface-hover border border-border rounded-lg px-2 py-1.5 text-foreground text-sm"
                    />
                    <span className="text-muted-foreground text-xs">to</span>
                    <input
                      type="time" value={h.close}
                      onChange={(e) => setOpeningHours((prev) => prev.map((d, j) => j === i ? { ...d, close: e.target.value } : d))}
                      className="flex-1 bg-surface-hover border border-border rounded-lg px-2 py-1.5 text-foreground text-sm"
                    />
                    {i === 0 && (
                      <button
                        type="button"
                        onClick={() => setOpeningHours((prev) => prev.map((d) => ({ ...d, open: prev[0].open, close: prev[0].close })))}
                        title="Apply Monday's hours to every day"
                        className="flex-shrink-0 text-muted-foreground hover:text-foreground text-xs underline"
                      >
                        Copy to all
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-1 text-muted-foreground text-xs">Leave a day blank if you're closed. A close time earlier than open (e.g. 12:00 to 01:00) means past midnight.</p>
        </Card>

        <Card icon="💷" title="Till & bookings" hint="The till's card reader, the table-booking deposit and the start of the working week.">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Till card reader</label>
              <select value={tillProvider} onChange={(e) => { setTillProvider(e.target.value as "sumup" | "stripe" | "none"); setPairError(""); setPairedStatus(""); }} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm">
                <option value="none">None — manual &quot;Card Paid&quot; button (separate card machine)</option>
                <option value="sumup">SumUp Solo</option>
                <option value="stripe">Stripe Reader</option>
              </select>
              <p className="mt-1 text-muted-foreground text-xs">Online payments always use Stripe; this only sets the card reader at the till.</p>
            </div>

            {tillProvider !== "none" && (
              <>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">{tillProvider === "sumup" ? "SumUp Solo reader ID" : "Card Reader ID (Stripe Terminal)"}</label>
                  <input
                    type="text"
                    placeholder={tillProvider === "sumup" ? "Filled in by pairing below" : "tmr_… (from pairing below)"}
                    value={tillProvider === "sumup" ? sumupReaderId : readerId}
                    onChange={(e) => (tillProvider === "sumup" ? setSumupReaderId(e.target.value) : setReaderId(e.target.value))}
                    className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm font-mono"
                  />
                  <p className="mt-1 text-muted-foreground text-xs">Until a reader is paired, the till keeps the manual &quot;Card Paid&quot; button.</p>
                </div>

                <div className="rounded-lg border border-border bg-surface-hover p-3">
                  <p className="text-xs font-semibold text-foreground">{tillProvider === "sumup" ? "Pair the SumUp Solo" : "Pair a new Stripe Reader"}</p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {tillProvider === "sumup" ? (
                      <>
                        On the Solo: make sure it&apos;s logged out and on Wi-Fi, then open the top menu →{" "}
                        <b>Connections</b> → <b>API</b> → <b>Connect</b>. It shows a pairing code — enter it here
                        within 5 minutes. This links the Solo and fills in the reader ID above.
                      </>
                    ) : (
                      <>
                        On the reader, open its settings and choose to connect / generate a pairing code — it shows a
                        short registration code (e.g. <span className="font-mono">quick-brown-fox</span>). Enter it here
                        within a few minutes. This registers the reader and fills in the Card Reader ID field above.
                      </>
                    )}
                  </p>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text" placeholder={tillProvider === "sumup" ? "Pairing code from the Solo" : "Registration code from the reader"} value={regCode}
                      onChange={(e) => setRegCode(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm font-mono"
                    />
                    <input
                      type="text" placeholder="Label (e.g. Reception)" value={readerName}
                      onChange={(e) => setReaderName(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground text-sm"
                    />
                  </div>
                  <button
                    onClick={pairReader}
                    disabled={pairing || !regCode.trim() || !readerName.trim()}
                    className="mt-3 px-4 py-2 bg-elevated hover:bg-elevated-hover disabled:opacity-50 text-foreground text-xs font-semibold rounded-lg border border-elevated"
                  >
                    {pairing ? "Pairing…" : "Pair Reader"}
                  </button>
                  {pairError && <p className="mt-2 text-red-600 text-xs">{pairError}</p>}
                  {pairedStatus && <p className="mt-2 text-emerald-600 text-xs">{pairedStatus}</p>}
                </div>
              </>
            )}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Reservation Deposit (£)</label>
              <input type="number" step="0.01" min="0" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
              <p className="mt-1 text-muted-foreground text-xs">0 = no deposit required. When set, new website reservations (not waitlist entries) are redirected to pay this online before confirming.</p>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Week Start Day</label>
              <select value={weekStartDay} onChange={(e) => setWeekStartDay(e.target.value)} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm">
                <option value="Monday">Monday</option>
                <option value="Sunday">Sunday</option>
              </select>
            </div>
        </Card>

        <Card icon="🌐" title="Website" hint="What customers see on the homepage and About page." wide>
          <p className="text-xs font-semibold text-foreground">Hero banner (top of the homepage)</p>
              <input
                placeholder="Small tag line above the headline" value={heroContent.tag}
                onChange={(e) => setHeroContent((h) => ({ ...h, tag: e.target.value }))}
                className="mt-1.5 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
              />
              <input
                placeholder="Headline (white part)" value={heroContent.headline}
                onChange={(e) => setHeroContent((h) => ({ ...h, headline: e.target.value }))}
                className="mt-1.5 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
              />
              <input
                placeholder="Headline (gold/italic part)" value={heroContent.headlineGold}
                onChange={(e) => setHeroContent((h) => ({ ...h, headlineGold: e.target.value }))}
                className="mt-1.5 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
              />
              <textarea
                placeholder="Description" value={heroContent.description} rows={2}
                onChange={(e) => setHeroContent((h) => ({ ...h, description: e.target.value }))}
                className="mt-1.5 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
              />

              <p className="mt-4 text-xs font-semibold text-foreground">Rotating photos ({heroImages.length})</p>
              <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {heroImages.map((url, i) => (
                  <div key={url} className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary uploaded URLs, not a next/image-optimizable static path */}
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 opacity-0 group-hover:opacity-100">
                      {i > 0 && (
                        <button type="button" onClick={() => setHeroImages((prev) => { const next = [...prev]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; })} className="text-white text-xs">
                          ← Move earlier
                        </button>
                      )}
                      <button type="button" onClick={() => setHeroImages((prev) => prev.filter((_, j) => j !== i))} className="text-red-300 text-xs font-semibold">
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground hover:border-red-400 hover:text-red-600">
                  <span className="text-xs font-semibold">{uploadingHero ? "Uploading…" : "+ Add photo"}</span>
                  <input
                    type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploadingHero}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadHeroImage(f); e.target.value = ""; }}
                  />
                </label>
              </div>
              {uploadError && <p className="mt-1 text-red-600 text-xs">{uploadError}</p>}
              <p className="mt-1 text-muted-foreground text-xs">JPEG, PNG or WEBP, up to 10MB. New photos are added to the end of the rotation.</p>
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-foreground">Our story</p>
              <p className="mt-3 text-xs font-semibold text-foreground">Homepage excerpt</p>
              <input
                placeholder="Heading (black part)" value={aboutExcerpt.title}
                onChange={(e) => setAboutExcerpt((a) => ({ ...a, title: e.target.value }))}
                className="mt-1.5 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
              />
              <input
                placeholder="Heading (gold/italic part)" value={aboutExcerpt.titleGold}
                onChange={(e) => setAboutExcerpt((a) => ({ ...a, titleGold: e.target.value }))}
                className="mt-1.5 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
              />
              <textarea
                placeholder="First paragraph" value={aboutExcerpt.text1} rows={2}
                onChange={(e) => setAboutExcerpt((a) => ({ ...a, text1: e.target.value }))}
                className="mt-1.5 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
              />
              <textarea
                placeholder="Second paragraph" value={aboutExcerpt.text2} rows={2}
                onChange={(e) => setAboutExcerpt((a) => ({ ...a, text2: e.target.value }))}
                className="mt-1.5 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
              />

              <p className="mt-4 text-xs font-semibold text-foreground">Full story (About page)</p>
              <div className="mt-1.5 space-y-2">
                {storyParagraphs.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <textarea
                      value={p} rows={2}
                      onChange={(e) => setStoryParagraphs((prev) => prev.map((x, j) => j === i ? e.target.value : x))}
                      className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setStoryParagraphs((prev) => prev.filter((_, j) => j !== i))}
                      className="flex-shrink-0 text-muted-foreground hover:text-red-600 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setStoryParagraphs((prev) => [...prev, ""])}
                className="mt-2 text-red-600 text-xs font-semibold"
              >
                + Add paragraph
              </button>
          </div>
          <div className="border-t border-border pt-4">
            <label className="block text-xs text-muted-foreground mb-1">Google review link</label>
              <input
                type="url" placeholder="https://g.page/r/…/review" value={googleReviewUrl}
                onChange={(e) => setGoogleReviewUrl(e.target.value)}
                className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
              />
              <p className="mt-1 text-muted-foreground text-xs">
                Used in the &quot;How was your meal?&quot; email sent the day after an order, only to customers who opted in to hear from us.
                Leave blank to send none. Find it in Google Maps → your restaurant → Reviews → &quot;Ask for reviews&quot;.
              </p>
          </div>
        </Card>

        <Card icon="📍" title="Clock-in location" hint="Stops staff clocking in away from the restaurant.">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-foreground text-sm font-medium">Geofenced Clock-In</p>
                  <p className="text-muted-foreground text-xs">Blocks self-service clock-in unless staff are near the restaurant. Clock-out is never blocked.</p>
                </div>
                <button onClick={() => setGeofenceEnabled((v) => !v)}
                  className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${geofenceEnabled ? "bg-red-600" : "bg-elevated"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${geofenceEnabled ? "translate-x-6" : ""}`} />
                </button>
              </div>

              {geofenceEnabled && (
                <div className="mt-3 space-y-3">
                  {(!restaurantLat || !restaurantLng) && (
                    <p className="text-amber-600 text-xs">⚠ Set the restaurant&apos;s location below — geofencing has no effect until this is filled in.</p>
                  )}
                  <button onClick={useCurrentLocation} disabled={locating}
                    className="w-full py-2 bg-elevated hover:bg-elevated-hover disabled:opacity-50 text-foreground text-sm font-semibold rounded-lg">
                    {locating ? "Getting location…" : "📍 Use My Current Location"}
                  </button>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Latitude</label>
                      <input type="number" step="0.000001" value={restaurantLat} onChange={(e) => setRestaurantLat(e.target.value)}
                        className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Longitude</label>
                      <input type="number" step="0.000001" value={restaurantLng} onChange={(e) => setRestaurantLng(e.target.value)}
                        className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Allowed Radius (metres)</label>
                    <input type="number" min="10" value={geofenceRadius} onChange={(e) => setGeofenceRadius(e.target.value)}
                      className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
                    <p className="mt-1 text-muted-foreground text-xs">150m is a reasonable default — GPS on a phone is typically accurate to 10-30m, tighter than that will cause false rejections.</p>
                  </div>
                  <p className="text-muted-foreground text-xs">A manager can always clock a team member in manually from Attendance → Team, bypassing this check (GPS trouble, dead phone, etc.). Browser location can be spoofed, so treat this as a soft deterrent, not a hard security control.</p>
                </div>
              )}
        </Card>

        <Card icon="👥" title="Staff" hint="Limits and pay rules for this business.">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Employee Limit</label>
              <input type="number" value={maxEmployees} onChange={(e) => setMaxEmployees(e.target.value)} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
              <p className="mt-1 text-muted-foreground text-xs">Blocks adding new employees once this many are active.</p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-foreground text-sm font-medium">Automatic Overtime</p>
                <p className="text-muted-foreground text-xs">Currently off — all hours pay at the flat rate.</p>
              </div>
              <button onClick={() => setOvertimeEnabled((v) => !v)}
                className={`w-12 h-6 rounded-full transition-colors relative ${overtimeEnabled ? "bg-red-600" : "bg-elevated"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${overtimeEnabled ? "translate-x-6" : ""}`} />
              </button>
            </div>
          <p className="text-muted-foreground text-xs">Company name, currency and VAT rate are in <b>Business setup</b>.</p>
        </Card>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <span className="mr-auto text-xs text-muted-foreground">{saved ? "✓ Saved" : "Save to apply the changes above."}</span>
        <button onClick={save} disabled={saving} className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50">
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FeaturedDishesPanel />
        <PromotionPanel />
      </div>
    </div>
  );
}

function Card({ icon, title, hint, wide, children }: { icon: string; title: string; hint: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={`space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] ${wide ? "md:col-span-2" : ""}`}>
      <div>
        <h2 className="flex items-center gap-2 text-[15.5px] font-bold text-foreground"><span aria-hidden>{icon}</span>{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}
