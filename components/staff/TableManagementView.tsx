"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { confirmDelete } from "@/components/ui/confirm";
import {
  GRID_H, GRID_W, SHAPES, SHAPE_LABEL, effectiveRotation, footprint, freeSpot, keepOnFloor, outline, overlaps,
  placeTables, round2, type Placed, type Shape,
} from "@/lib/floor-plan";

// Staff Hub → Tables: the restaurant's floor plan. Drag a table anywhere
// (it saves when you let go; "Snap to grid" lines tables up in whole
// cells); tap one to change its number, seats, shape or turn (45° steps), or
// delete it. The till's table screen draws the
// same plan. Read-only without full Tables access; on a phone, tables can't
// be dragged but can still be edited from the panel.

type Table = {
  id: number;
  table_number: string;
  capacity: number;
  status: "available" | "occupied" | "reserved";
  pos_x: number | null;
  pos_y: number | null;
  shape: Shape | null;
  rotation: number | null;
};
type Spot = Placed<Table>;

const STATUS: Record<Table["status"], { label: string; fill: string; ring: string }> = {
  available: { label: "Free", fill: "bg-white", ring: "border-emerald-500/60" },
  occupied: { label: "Occupied", fill: "bg-red-50", ring: "border-red-400" },
  reserved: { label: "Reserved", fill: "bg-amber-50", ring: "border-amber-400" },
};

const heading = { fontFamily: "var(--font-space-grotesk)" };

export default function TableManagementView({ canEdit }: { canEdit: boolean }) {
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: number; x: number; y: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const [wide, setWide] = useState(true);
  const [snap, setSnap] = useState(false);
  useEffect(() => {
    try { setSnap(localStorage.getItem("floorplan_snap") === "1"); } catch { /* private mode */ }
  }, []);
  const toggleSnap = () => setSnap((v) => {
    try { localStorage.setItem("floorplan_snap", v ? "0" : "1"); } catch { /* private mode */ }
    return !v;
  });
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ id: number; offX: number; offY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    const res = await fetch("/api/tables", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setTables(data.tables || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Dragging needs a real pointer and room: not on a phone.
  useEffect(() => {
    const m = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  const canDrag = canEdit && wide;

  const placed = useMemo(() => placeTables(tables), [tables]);
  const shown: Spot[] = placed.map((p) => (drag && drag.id === p.id ? { ...p, x: drag.x, y: drag.y } : p));
  const sel = placed.find((p) => p.id === selected) ?? null;
  const totalSeats = tables.reduce((s, t) => s + t.capacity, 0);

  async function call(url: string, method: string, body?: unknown, quiet = false) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ variant: "destructive", title: "Couldn't save", description: data.error || "Something went wrong" });
        await load();
        return null;
      }
      if (quiet) { setSaved(true); setTimeout(() => setSaved(false), 1500); }
      await load();
      return data;
    } finally {
      setBusy(false);
    }
  }

  // ---- dragging ----------------------------------------------------------
  function cellAt(clientX: number, clientY: number) {
    const r = canvasRef.current!.getBoundingClientRect();
    return { cx: ((clientX - r.left) / r.width) * GRID_W, cy: ((clientY - r.top) / r.height) * GRID_H };
  }

  function onPointerDown(e: React.PointerEvent, t: Spot) {
    setSelected(t.id);
    if (!canDrag) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { cx, cy } = cellAt(e.clientX, e.clientY);
    dragStart.current = { id: t.id, offX: cx - t.x, offY: cy - t.y, startX: cx, startY: cy, moved: false };
  }

  function onPointerMove(e: React.PointerEvent, t: Spot) {
    const d = dragStart.current;
    if (!d || d.id !== t.id) return;
    const { cx, cy } = cellAt(e.clientX, e.clientY);
    // A tap wobbles a little — only a real drag (half a cell or more) moves it.
    if (!d.moved && Math.hypot(cx - d.startX, cy - d.startY) < 0.5) return;
    d.moved = true;
    const rawX = snap ? Math.round(cx - d.offX) : round2(cx - d.offX);
    const rawY = snap ? Math.round(cy - d.offY) : round2(cy - d.offY);
    setDrag({ id: t.id, ...keepOnFloor(rawX, rawY, t.w, t.h, t.rotation) });
  }

  async function onPointerUp(t: Spot) {
    const d = dragStart.current;
    dragStart.current = null;
    if (!d || !drag || drag.id !== t.id) { setDrag(null); return; }
    const spot = { x: drag.x, y: drag.y };
    setDrag(null);
    if (!d.moved) return;
    const box = outline(spot.x, spot.y, t.w, t.h, t.rotation);
    if (placed.some((p) => p.id !== t.id && overlaps(box, p.box))) {
      toast({ variant: "destructive", title: "Tables can't overlap", description: "Drop it in a clear space." });
      return;
    }
    // Show it in its new place straight away, then save.
    setTables((list) => list.map((x) => (x.id === t.id ? { ...x, pos_x: spot.x, pos_y: spot.y } : x)));
    await call("/api/tables", "PUT", { id: t.id, pos_x: spot.x, pos_y: spot.y }, true);
  }

  // ---- editing ------------------------------------------------------------
  // Positions of every table as shown — saved with any change so a table
  // laid out automatically keeps its place once the plan is edited.
  async function saveAllUnsaved() {
    const unsaved = placed.filter((p) => p.pos_x == null || p.pos_y == null);
    for (const p of unsaved) await fetch("/api/tables", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, pos_x: p.x, pos_y: p.y }) });
  }
  useEffect(() => {
    if (canEdit && !loading && placed.some((p) => p.pos_x == null)) saveAllUnsaved().then(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, canEdit]);

  async function addTable() {
    const nums = tables.map((t) => parseInt(t.table_number.replace(/\D/g, ""), 10)).filter(Number.isFinite);
    const number = `T${(nums.length ? Math.max(...nums) : 0) + 1}`;
    const { w, h } = footprint(4, "square");
    const spot = freeSpot(placed.map((p) => p.box), w, h);
    const data = await call("/api/tables", "POST", { table_number: number, capacity: 4, shape: "square", pos_x: spot.x, pos_y: spot.y });
    if (data?.table) {
      setSelected(data.table.id);
      toast({ variant: "success", title: `${number} added`, description: "Drag it into place, then set its seats." });
    }
  }

  async function update(t: Spot, change: Partial<Pick<Table, "table_number" | "capacity" | "shape" | "rotation">>) {
    // A bigger, reshaped or turned table must still fit where it is: keep its
    // centre, stay on the floor, and if it now overlaps a neighbour, move it
    // to a free space.
    const capacity = change.capacity ?? t.capacity;
    const shape = change.shape ?? t.shape;
    const rotation = effectiveRotation(shape, change.rotation ?? t.rotation);
    const { w, h } = footprint(capacity, shape);
    let at = keepOnFloor(round2(t.x + t.w / 2 - w / 2), round2(t.y + t.h / 2 - h / 2), w, h, rotation);
    let moved = false;
    if (placed.some((p) => p.id !== t.id && overlaps(outline(at.x, at.y, w, h, rotation), p.box))) {
      at = freeSpot(placed.filter((p) => p.id !== t.id).map((p) => p.box), w, h);
      moved = true;
    }
    const pos = at.x !== t.x || at.y !== t.y ? { pos_x: at.x, pos_y: at.y } : {};
    if (moved) toast({ title: `${t.table_number} moved to fit`, description: "It no longer fitted there — drag it back where you want it." });
    await call("/api/tables", "PUT", { id: t.id, ...change, ...pos }, true);
  }

  async function remove(t: Spot) {
    if (!(await confirmDelete(`table ${t.table_number}`))) return;
    if (await call(`/api/tables?id=${t.id}`, "DELETE")) setSelected(null);
  }

  return (
    <div className="px-4 py-6 md:px-6">
      <div className="mx-auto max-w-[1240px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 style={heading} className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">Tables</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {tables.length} table{tables.length === 1 ? "" : "s"} · {totalSeats} seats
              {canDrag ? " · drag a table anywhere, tap it to edit" : canEdit ? " · tap a table to edit it" : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm font-semibold text-emerald-600">✓ Saved</span>}
            {canDrag && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input type="checkbox" className="h-4 w-4 accent-red-600" checked={snap} onChange={toggleSnap} />
                Snap to grid
              </label>
            )}
            {canEdit && (
              <button onClick={addTable} disabled={busy} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50">
                + Add table
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_280px]">
          {/* The floor */}
          <div className="rounded-2xl border border-border bg-surface p-3">
            {loading ? (
              <p className="py-20 text-center text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div
                ref={canvasRef}
                onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
                className="relative w-full select-none rounded-xl bg-[#FBF8F1]"
                style={{
                  aspectRatio: `${GRID_W} / ${GRID_H}`,
                  ...(snap ? {
                    backgroundImage: "linear-gradient(#ECE5D6 1px, transparent 1px), linear-gradient(90deg, #ECE5D6 1px, transparent 1px)",
                    backgroundSize: `${100 / GRID_W}% ${100 / GRID_H}%`,
                  } : {}),
                }}
              >
                {shown.map((t) => {
                  const st = STATUS[t.status] ?? STATUS.available;
                  const isSel = t.id === selected;
                  const dragging = drag?.id === t.id;
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Table ${t.table_number}, ${t.capacity} seats`}
                      onPointerDown={(e) => onPointerDown(e, t)}
                      onPointerMove={(e) => onPointerMove(e, t)}
                      onPointerUp={() => onPointerUp(t)}
                      onPointerCancel={() => { dragStart.current = null; setDrag(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") setSelected(t.id); }}
                      className={`absolute flex flex-col items-center justify-center border-2 ${st.fill} ${isSel ? "border-blue-500 ring-2 ring-blue-400/40" : st.ring} ${t.shape === "round" ? "rounded-full" : "rounded-lg"} ${canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${dragging ? "z-10 opacity-90 shadow-lg" : "shadow-sm"} touch-none transition-[box-shadow]`}
                      style={{
                        left: `${(t.x / GRID_W) * 100}%`, top: `${(t.y / GRID_H) * 100}%`,
                        width: `${(t.w / GRID_W) * 100}%`, height: `${(t.h / GRID_H) * 100}%`,
                        transform: t.rotation ? `rotate(${t.rotation}deg)` : undefined,
                      }}
                    >
                      <span className="flex flex-col items-center" style={t.rotation ? { transform: `rotate(${-t.rotation}deg)` } : undefined}>
                        <span className="text-[clamp(11px,1.4vw,17px)] font-black leading-none text-foreground">{t.table_number}</span>
                        <span className="mt-0.5 text-[clamp(9px,0.9vw,11px)] text-muted-foreground">{t.capacity} seats</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-3 text-[11.5px] text-muted-foreground">
              {(Object.keys(STATUS) as Table["status"][]).map((k) => (
                <span key={k} className="flex items-center gap-1.5"><span className={`h-3 w-3 rounded border-2 ${STATUS[k].fill} ${STATUS[k].ring}`} />{STATUS[k].label}</span>
              ))}
              <span>· The till shows this same plan.</span>
            </div>
          </div>

          {/* The selected table */}
          <div className="rounded-2xl border border-border bg-surface p-4 self-start">
            {!sel ? (
              <p className="text-sm text-muted-foreground">
                {canEdit ? "Tap a table to change its number, seats or shape." : "Tap a table to see its details."}
              </p>
            ) : (
              <TablePanel key={sel.id} t={sel} canEdit={canEdit} busy={busy} onUpdate={(c) => update(sel, c)} onDelete={() => remove(sel)} />
            )}
            {!canEdit && <p className="mt-3 text-xs text-muted-foreground">You can view the floor plan; changes are made by someone with full Tables access.</p>}
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          A table that&apos;s already had orders or bookings can&apos;t be deleted — rename it instead if you&apos;re rearranging the floor.
        </p>
      </div>
    </div>
  );
}

function TablePanel({ t, canEdit, busy, onUpdate, onDelete }: {
  t: Spot; canEdit: boolean; busy: boolean;
  onUpdate: (c: Partial<Pick<Table, "table_number" | "capacity" | "shape" | "rotation">>) => void; onDelete: () => void;
}) {
  const [number, setNumber] = useState(t.table_number);
  const saveNumber = () => { const n = number.trim(); if (n && n !== t.table_number) onUpdate({ table_number: n }); else setNumber(t.table_number); };
  return (
    <div>
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Table</p>
      <input value={number} onChange={(e) => setNumber(e.target.value)} disabled={!canEdit || busy}
        onBlur={saveNumber} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="mt-1 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-lg font-bold text-foreground disabled:opacity-80" />

      <p className="mt-4 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Seats</p>
      <div className="mt-1 flex items-center gap-3">
        <button type="button" onClick={() => onUpdate({ capacity: t.capacity - 1 })} disabled={!canEdit || busy || t.capacity <= 1}
          className="h-10 w-10 rounded-full border border-border text-xl font-bold hover:bg-surface-hover disabled:opacity-40">−</button>
        <span className="min-w-[2ch] text-center text-2xl font-bold tabular-nums">{t.capacity}</span>
        <button type="button" onClick={() => onUpdate({ capacity: t.capacity + 1 })} disabled={!canEdit || busy || t.capacity >= 30}
          className="h-10 w-10 rounded-full border border-border text-xl font-bold hover:bg-surface-hover disabled:opacity-40">+</button>
      </div>

      <p className="mt-4 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Shape</p>
      <div className="mt-1 flex gap-2">
        {SHAPES.map((s) => (
          <button key={s} type="button" onClick={() => onUpdate({ shape: s })} disabled={!canEdit || busy}
            aria-pressed={t.shape === s}
            className={`flex flex-1 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold ${t.shape === s ? "border-red-500 bg-red-50 text-red-700" : "border-border hover:bg-surface-hover"} disabled:opacity-60`}>
            <span className={`block border-2 border-current ${s === "round" ? "h-5 w-5 rounded-full" : s === "rect" ? "h-4 w-8 rounded" : "h-5 w-5 rounded"}`} />
            {SHAPE_LABEL[s]}
          </button>
        ))}
      </div>

      {t.shape !== "round" && (
        <>
          <p className="mt-4 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Turn</p>
          <div className="mt-1 flex items-center gap-3">
            <button type="button" onClick={() => onUpdate({ rotation: t.rotation - 45 })} disabled={!canEdit || busy}
              aria-label="Turn left 45°" className="h-10 w-10 rounded-full border border-border text-lg hover:bg-surface-hover disabled:opacity-40">↺</button>
            <span className="min-w-[3ch] text-center text-lg font-bold tabular-nums">{t.rotation}°</span>
            <button type="button" onClick={() => onUpdate({ rotation: t.rotation + 45 })} disabled={!canEdit || busy}
              aria-label="Turn right 45°" className="h-10 w-10 rounded-full border border-border text-lg hover:bg-surface-hover disabled:opacity-40">↻</button>
            {t.rotation !== 0 && (
              <button type="button" onClick={() => onUpdate({ rotation: 0 })} disabled={!canEdit || busy} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Straighten</button>
            )}
          </div>
        </>
      )}

      {canEdit && (
        <button type="button" onClick={onDelete} disabled={busy} className="mt-5 w-full rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
          Delete table
        </button>
      )}
    </div>
  );
}
