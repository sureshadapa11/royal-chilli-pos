"use client";

import { useRef, useState } from "react";

// Photo proof for money going out (migration 110). Each photo is checked on
// the device before it's uploaded — too blurry, too dark or too small is
// refused straight away, with what to do. The form can't save without at least
// one photo. (No glare check: screenshots of bank payments are mostly white.)

export type Receipt = { id: number; preview: string };
type Entity = "expense" | "supplier_payment" | "purchase_order";

const MAX_SIDE = 1600; // stored size: plenty to read a receipt, small to keep
const MIN_SIDE = 600;  // smaller than this can't show a receipt's small print
const SHARP_MIN = 40;  // blur score below this = too blurry to read (calibrated: sharp ≈ 1000+, readable-soft ≈ 60, unreadable < 20); same in app/api/receipts
const DARK_MAX = 55;   // average brightness below this = too dark

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Not an image")); };
    img.src = url;
  });
}

/**
 * Blur and darkness check. Sharpness is the spread of the Laplacian (how
 * crisp the edges are), measured in small tiles and taken from the crispest
 * tenth, so plenty of plain paper around a sharp receipt doesn't count
 * against it.
 */
export function photoQuality(img: HTMLImageElement): { sharpness: number; brightness: number } {
  const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(16, Math.round(img.naturalWidth * scale));
  const h = Math.max(16, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  let total = 0;
  for (let i = 0; i < w * h; i++) {
    const g = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    gray[i] = g; total += g;
  }

  const TILE = 32;
  const scores: number[] = [];
  for (let ty = 1; ty + TILE < h - 1; ty += TILE) {
    for (let tx = 1; tx + TILE < w - 1; tx += TILE) {
      let sum = 0, sq = 0, n = 0;
      for (let y = ty; y < ty + TILE; y++) {
        for (let x = tx; x < tx + TILE; x++) {
          const i = y * w + x;
          const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
          sum += lap; sq += lap * lap; n++;
        }
      }
      const mean = sum / n;
      scores.push(sq / n - mean * mean);
    }
  }
  scores.sort((a, b) => b - a);
  const top = scores.slice(0, Math.max(1, Math.ceil(scores.length / 10)));
  return { sharpness: top.reduce((a, b) => a + b, 0) / top.length, brightness: total / (w * h) };
}

function toJpeg(img: HTMLImageElement): Promise<Blob> {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read the photo"))), "image/jpeg", 0.85));
}

export default function ReceiptPhotos({ entity, value, onChange, label = "Receipt / invoice photo" }: {
  entity: Entity;
  value: Receipt[];
  onChange: (next: Receipt[]) => void;
  label?: string;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");

  async function add(file: File | undefined) {
    if (!file) return;
    setProblem("");
    try {
      setBusy("Checking the photo…");
      const img = await loadImage(file);
      if (Math.max(img.naturalWidth, img.naturalHeight) < MIN_SIDE) { setProblem("The photo is too small to read. Take it with the camera, close enough that the receipt fills the screen."); return; }
      const q = photoQuality(img);
      if (q.brightness < DARK_MAX) { setProblem("The photo is too dark. Turn on a light or move to a brighter spot and retake it."); return; }
      if (q.sharpness < SHARP_MIN) { setProblem("The photo is blurry. Hold the phone steady, tap the screen to focus on the receipt, and retake it."); return; }

      const jpeg = await toJpeg(img);
      setBusy("Uploading…");
      const form = new FormData();
      form.append("file", jpeg, "receipt.jpg");
      form.append("entity", entity);
      form.append("sharpness", String(Math.round(q.sharpness)));
      const res = await fetch("/api/receipts", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setProblem(data.error || "Couldn't add the photo. Please try again."); return; }
      onChange([...value, { id: data.receipt.id, preview: URL.createObjectURL(jpeg) }]);
    } catch {
      setProblem("That file couldn't be opened as a photo.");
    } finally {
      setBusy("");
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-hover/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-foreground text-sm font-semibold">{label} <span className="text-red-600">*</span></span>
        <button type="button" disabled={!!busy} onClick={() => cameraRef.current?.click()} className="px-3 py-1.5 rounded-lg bg-foreground text-background text-xs font-semibold disabled:opacity-50">📷 Take photo</button>
        <button type="button" disabled={!!busy} onClick={() => fileRef.current?.click()} className="px-3 py-1.5 rounded-lg border border-border text-foreground text-xs font-semibold disabled:opacity-50">Choose file</button>
        {busy && <span className="text-muted-foreground text-xs">{busy}</span>}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => add(e.target.files?.[0])} />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => add(e.target.files?.[0])} />
      </div>
      {problem && <p className="mt-2 text-red-600 text-xs font-medium">✗ {problem}</p>}
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {value.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface p-1.5 pr-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.preview} alt="Receipt" className="h-12 w-12 rounded object-cover" />
              <a href={r.preview} target="_blank" rel="noopener noreferrer" className="text-xs leading-tight text-green-700 font-semibold">✓ Clear photo<br /><span className="font-normal text-muted-foreground">Tap to check it</span></a>
              <button type="button" onClick={() => onChange(value.filter((x) => x.id !== r.id))} className="ml-1 text-muted-foreground hover:text-red-600 text-sm" aria-label="Remove photo">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Links to an entry's photos in a list; flags old entries with none. */
export function ReceiptLinks({ photos }: { photos: { id: number }[] | undefined }) {
  if (!photos || photos.length === 0) return <span className="text-muted-foreground text-xs">No photo</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {photos.map((p, i) => (
        <a key={p.id} href={`/api/receipts/${p.id}/url`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-red-600 hover:underline">
          📎{photos.length > 1 ? ` ${i + 1}` : " Receipt"}
        </a>
      ))}
    </span>
  );
}
