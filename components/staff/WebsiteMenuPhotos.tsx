"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Staff Hub → Website → Menu & photos: which dishes are on the website menu,
// each dish's photo (shown on the online order menu), and the photos on the
// website's Gallery page. Same switches as Menu → a dish's "On website menu",
// all in one list.

type Item = {
  id: number; name: string; active: number; online_available: number;
  image_url: string | null; display_order: number; menu_categories: { name: string } | null;
};
type Photo = { id: number; image_url: string; caption: string | null };

const heading = { fontFamily: "var(--font-space-grotesk)" };
const card = "mt-5 rounded-[14px] border border-border bg-surface p-4 md:p-5";

async function upload(file: File, folder: "menu" | "gallery"): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  const res = await fetch("/api/site-content/upload", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data.url as string;
}

export default function WebsiteMenuPhotos() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | "gallery" | null>(null);
  const [filter, setFilter] = useState("");
  const fileFor = useRef<number | null>(null);
  const dishInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [m, g] = await Promise.all([
      fetch("/api/menu-items", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/website/gallery", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (!m) return setError("Couldn't load the menu");
    setItems((m.items || []).filter((i: Item) => i.active));
    setPhotos(g?.photos || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function patch(id: number, body: Partial<Item>) {
    setBusy(id); setError("");
    try {
      const res = await fetch(`/api/menu-items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save");
      setItems((list) => (list || []).map((i) => (i.id === id ? { ...i, ...body } : i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(null);
    }
  }

  async function dishPhoto(file: File) {
    const id = fileFor.current;
    if (!id) return;
    setBusy(id); setError("");
    try {
      const url = await upload(file, "menu");
      await patch(id, { image_url: url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setBusy(null);
    }
  }

  async function addGalleryPhoto(file: File) {
    setBusy("gallery"); setError("");
    try {
      const url = await upload(file, "gallery");
      const res = await fetch("/api/website/gallery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_url: url }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't add the photo");
      setPhotos((p) => [...p, data.photo]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function removeGalleryPhoto(id: number) {
    setBusy("gallery"); setError("");
    const res = await fetch(`/api/website/gallery?id=${id}`, { method: "DELETE" });
    if (res.ok) setPhotos((p) => p.filter((x) => x.id !== id));
    else setError("Couldn't remove the photo");
    setBusy(null);
  }

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const map = new Map<string, Item[]>();
    for (const i of items || []) {
      if (q && !i.name.toLowerCase().includes(q)) continue;
      const cat = i.menu_categories?.name || "Other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(i);
    }
    return [...map.entries()];
  }, [items, filter]);

  const onlineCount = (items || []).filter((i) => i.online_available).length;
  const photoCount = (items || []).filter((i) => i.image_url).length;

  return (
    <>
      <section className={card} aria-labelledby="website-menu">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 id="website-menu" style={heading} className="text-[17px] font-semibold text-foreground">Menu &amp; photos</h2>
          {items && (
            <span className="text-[12.5px] text-muted-foreground">
              {onlineCount} of {items.length} dishes on the website · {photoCount} with a photo
            </span>
          )}
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a dish…"
            className="ml-auto w-44 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px]" />
        </div>
        <p className="mb-3 text-[13px] text-muted-foreground">
          Untick a dish to keep it off the website menu (it stays on the till). A dish&apos;s photo shows next to it on the online order menu.
        </p>
        {error && <p role="alert" className="mb-2 text-sm text-red-600">{error}</p>}
        <input ref={dishInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) dishPhoto(f); }} />

        {!items ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="max-h-[560px] space-y-4 overflow-y-auto pr-1">
            {groups.map(([cat, list]) => (
              <div key={cat}>
                <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{cat}</p>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {list.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-md border border-border bg-surface-hover">
                        {i.image_url && (
                          // eslint-disable-next-line @next/next/no-img-element -- uploaded photo
                          <img src={i.image_url} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <span className={`min-w-0 flex-1 truncate text-[14px] ${i.online_available ? "text-foreground" : "text-muted-foreground line-through"}`}>{i.name}</span>
                      <button type="button" disabled={busy === i.id}
                        onClick={() => { fileFor.current = i.id; dishInput.current?.click(); }}
                        className="rounded-lg border border-border px-2.5 py-1 text-[12.5px] font-semibold hover:bg-surface-hover disabled:opacity-60">
                        {busy === i.id ? "Saving…" : i.image_url ? "Change photo" : "Add photo"}
                      </button>
                      {i.image_url && (
                        <button type="button" disabled={busy === i.id} onClick={() => patch(i.id, { image_url: null })}
                          className="text-[12.5px] text-muted-foreground hover:text-red-600 disabled:opacity-60">Remove</button>
                      )}
                      <label className="flex items-center gap-1.5 text-[12.5px] text-foreground">
                        <input type="checkbox" className="h-4 w-4 accent-red-600" checked={!!i.online_available} disabled={busy === i.id}
                          onChange={(e) => patch(i.id, { online_available: e.target.checked ? 1 : 0 })} />
                        On website
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {groups.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No dishes match.</p>}
          </div>
        )}
      </section>

      <section className={card} aria-labelledby="website-gallery">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 id="website-gallery" style={heading} className="text-[17px] font-semibold text-foreground">Gallery</h2>
          <span className="text-[12.5px] text-muted-foreground">{photos.length} uploaded</span>
          <button type="button" disabled={busy === "gallery"} onClick={() => galleryInput.current?.click()}
            className="ml-auto rounded-lg bg-red-600 px-3 py-1.5 text-[13px] font-bold text-white hover:bg-red-500 disabled:opacity-60">
            {busy === "gallery" ? "Working…" : "+ Add photo"}
          </button>
          <input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) addGalleryPhoto(f); }} />
        </div>
        <p className="mb-3 text-[13px] text-muted-foreground">
          Photos for the website&apos;s Gallery page — shown first, before the restaurant&apos;s built-in photos. JPEG, PNG or WEBP, up to 10 MB.
        </p>
        {photos.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">No photos uploaded yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {photos.map((p) => (
              <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- uploaded photo */}
                <img src={p.image_url} alt={p.caption || ""} className="h-full w-full object-cover" />
                <button type="button" onClick={() => removeGalleryPhoto(p.id)} disabled={busy === "gallery"}
                  className="absolute right-1 top-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white hover:bg-red-600">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
