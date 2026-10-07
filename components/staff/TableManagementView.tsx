"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { confirmDelete } from "@/components/ui/confirm";
import {
  COLS, GRID_H, GRID_W, ROWS, TABLE_SIZE, freeSlot, nearestSlot, placeTables, slotXY, type Placed,
} from "@/lib/floor-plan";

// Staff Hub → Tables: the restaurant's floor plan — equal tables in rows and
// columns of slots. Drag a table to an empty slot, or onto another table to
// swap the two (it saves when you let go); tap one to change its number or
// seats, or delete it. The till's table screen draws the same plan.
// Read-only without full Tables access. On a phone, "Move tables" switches
// dragging on (otherwise a finger scrolls the page), the plan can be zoomed,
// and a tapped table opens in a sheet from the bottom.

type Table = {
  id: number;
  table_number: string;
  capacity: number;
  status: "available" | "occupied" | "reserved";
  pos_x: number | null;
  pos_y: number | null;
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
  // Phones: sliding a finger scrolls the page, so moving tables is a switch;
  // the plan can be zoomed to place small tables precisely.
  const [moveMode, setMoveMode] = useState(false);
  const [zoom, setZoom] = useState(1);
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
  const canDrag = canEdit && (wide || moveMode);

  const placed = useMemo(() => placeTables(tables), [tables]);
  const shown: Spot[] = placed.map((p) => (drag && drag.id === p.id ? { ...p, x: drag.x, y: drag.y } : p));
  const target = drag ? nearestSlot(drag.x, drag.y) : null;
  const taken = new Set(placed.map((p) => `${p.col},${p.row}`));
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
    // A plain tap selects (see onPointerUp); with dragging off, select now.
    if (!canDrag) { setSelected(t.id); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    const { cx, cy } = cellAt(e.clientX, e.clientY);
    dragStart.current = { id: t.id, offX: cx - t.x, offY: cy - t.y, startX: cx, startY: cy, moved: false };
  }

  // Where the table would be with the pointer here (it follows the finger
  // freely), or null if it hasn't been dragged far enough to count (a tap
  // wobbles a little).
  function dropSpot(e: React.PointerEvent, t: Spot) {
    const d = dragStart.current;
    if (!d || d.id !== t.id) return null;
    const { cx, cy } = cellAt(e.clientX, e.clientY);
    if (!d.moved && Math.hypot(cx - d.startX, cy - d.startY) < 0.5) return null;
    d.moved = true;
    return { x: cx - d.offX, y: cy - d.offY };
  }

  function onPointerMove(e: React.PointerEvent, t: Spot) {
    const spot = dropSpot(e, t);
    if (spot) setDrag({ id: t.id, ...spot });
  }

  // The drop is worked out from the pointer itself, not from the last
  // re-render — a quick flick lets go before the screen has caught up. It
  // lands in the nearest slot; a table already there swaps into this one's.
  async function onPointerUp(e: React.PointerEvent, t: Spot) {
    const wasDrag = !!dragStart.current;
    const spot = dropSpot(e, t);
    dragStart.current = null;
    setDrag(null);
    // A tap opens the table; after a drag on a phone, the sheet stays shut
    // so you can carry on moving tables.
    if (wasDrag && (!spot || wide)) setSelected(t.id);
    if (!spot) return;
    const to = nearestSlot(spot.x, spot.y);
    if (to.col === t.col && to.row === t.row) return;
    const there = placed.find((p) => p.col === to.col && p.row === to.row);
    const moves = [{ id: t.id, ...slotXY(to.col, to.row) }];
    if (there) moves.push({ id: there.id, ...slotXY(t.col, t.row) });
    // Show it in its new place straight away, then save.
    setTables((list) => list.map((x) => {
      const m = moves.find((v) => v.id === x.id);
      return m ? { ...x, pos_x: m.x, pos_y: m.y } : x;
    }));
    await saveSpots(moves);
    if (there) toast({ title: `${t.table_number} and ${there.table_number} swapped places` });
  }

  async function saveSpots(moves: { id: number; x: number; y: number }[]) {
    setBusy(true);
    try {
      const results = await Promise.all(moves.map((m) => fetch("/api/tables", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: m.id, pos_x: m.x, pos_y: m.y }),
      })));
      if (results.some((r) => !r.ok)) toast({ variant: "destructive", title: "Couldn't save", description: "The plan has been reloaded — try again." });
      else { setSaved(true); setTimeout(() => setSaved(false), 1500); }
      await load();
    } finally {
      setBusy(false);
    }
  }

  // ---- editing ------------------------------------------------------------
  // Saves where each table is shown when that isn't exactly what's saved
  // (laid out automatically, or saved before tables sat in slots), so the
  // plan stays put once it's been edited.
  useEffect(() => {
    if (!canEdit || loading) return;
    const off = placed.filter((p) => p.pos_x == null || p.pos_y == null || Number(p.pos_x) !== p.x || Number(p.pos_y) !== p.y);
    if (off.length) saveSpots(off.map((p) => ({ id: p.id, x: p.x, y: p.y })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, canEdit]);

  async function addTable() {
    const nums = tables.map((t) => parseInt(t.table_number.replace(/\D/g, ""), 10)).filter(Number.isFinite);
    const number = `T${(nums.length ? Math.max(...nums) : 0) + 1}`;
    const slot = freeSlot(taken);
    if (slot.row >= ROWS) {
      toast({ variant: "destructive", title: "The floor plan is full", description: "Delete a table to make room." });
      return;
    }
    const { x, y } = slotXY(slot.col, slot.row);
    const data = await call("/api/tables", "POST", { table_number: number, capacity: 4, pos_x: x, pos_y: y });
    if (data?.table) {
      setSelected(data.table.id);
      toast({ variant: "success", title: `${number} added`, description: "Drag it into place, then set its seats." });
    }
  }

  async function update(t: Spot, change: Partial<Pick<Table, "table_number" | "capacity">>) {
    await call("/api/tables", "PUT", { id: t.id, ...change }, true);
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
              {canDrag ? " · drag a table to a free spot, or onto another to swap · tap to edit" : canEdit ? " · tap a table to edit it, or turn on Move tables" : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm font-semibold text-emerald-600">✓ Saved</span>}
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
            {!wide && canEdit && !loading && (
              <div className="mb-3 flex items-center gap-3">
                <button type="button" onClick={() => setMoveMode((m) => !m)} aria-pressed={moveMode}
                  className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-bold ${moveMode ? "bg-red-600 text-white" : "border border-border text-foreground"}`}>
                  {moveMode ? "✋ Moving tables — tap to finish" : "✋ Move tables"}
                </button>
                <div className="flex items-center overflow-hidden rounded-lg border border-border">
                  <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label="Zoom out" className="h-10 w-10 text-lg font-bold disabled:opacity-30">−</button>
                  <span className="w-10 text-center text-xs font-semibold tabular-nums">{zoom * 100}%</span>
                  <button type="button" onClick={() => setZoom((z) => Math.min(2.5, z + 0.5))} disabled={zoom >= 2.5} aria-label="Zoom in" className="h-10 w-10 text-lg font-bold disabled:opacity-30">+</button>
                </div>
              </div>
            )}
            {!wide && moveMode && <p className="mb-2 text-xs text-muted-foreground">Slide a table to move it. Slide the empty floor to look around.</p>}
            {loading ? (
              <p className="py-20 text-center text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className={!wide && zoom > 1 ? "overflow-auto rounded-xl" : ""}>
              <div
                ref={canvasRef}
                onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
                className="relative select-none rounded-xl bg-[#FBF8F1]"
                style={{
                  width: !wide ? `${zoom * 100}%` : "100%",
                  aspectRatio: `${GRID_W} / ${GRID_H}`,
                }}
              >
                {/* Empty slots while tables can be moved; the one a dragged table would land in is lit */}
                {canDrag && Array.from({ length: COLS * ROWS }, (_, i) => {
                  const col = i % COLS, row = Math.floor(i / COLS);
                  const isTarget = target?.col === col && target?.row === row;
                  if (taken.has(`${col},${row}`) && !isTarget) return null;
                  const { x, y } = slotXY(col, row);
                  return (
                    <div key={`slot-${i}`} aria-hidden
                      className={`pointer-events-none absolute rounded-lg border-2 border-dashed ${isTarget ? "border-blue-400 bg-blue-50/60" : "border-[#E6DDCB]"}`}
                      style={{ left: `${(x / GRID_W) * 100}%`, top: `${(y / GRID_H) * 100}%`, width: `${(TABLE_SIZE / GRID_W) * 100}%`, height: `${(TABLE_SIZE / GRID_H) * 100}%` }} />
                  );
                })}
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
                      onPointerUp={(e) => onPointerUp(e, t)}
                      onPointerCancel={() => { dragStart.current = null; setDrag(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") setSelected(t.id); }}
                      className={`absolute flex flex-col items-center justify-center border-2 ${st.fill} ${isSel ? "border-blue-500 ring-2 ring-blue-400/40" : st.ring} rounded-lg ${canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${dragging ? "z-10 opacity-90 shadow-lg" : "shadow-sm"} ${canDrag ? "touch-none" : "touch-manipulation"} transition-[box-shadow]`}
                      style={{
                        left: `${(t.x / GRID_W) * 100}%`, top: `${(t.y / GRID_H) * 100}%`,
                        width: `${(t.w / GRID_W) * 100}%`, height: `${(t.h / GRID_H) * 100}%`,
                      }}
                    >
                      <span className="flex flex-col items-center">
                        <span className="text-[clamp(11px,1.4vw,17px)] font-black leading-none text-foreground">{t.table_number}</span>
                        <span className="mt-0.5 text-[clamp(9px,0.9vw,11px)] text-muted-foreground">{t.capacity} seats</span>
                      </span>
                    </div>
                  );
                })}
              </div>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-3 text-[11.5px] text-muted-foreground">
              {(Object.keys(STATUS) as Table["status"][]).map((k) => (
                <span key={k} className="flex items-center gap-1.5"><span className={`h-3 w-3 rounded border-2 ${STATUS[k].fill} ${STATUS[k].ring}`} />{STATUS[k].label}</span>
              ))}
              <span>· The till shows this same plan.</span>
            </div>
          </div>

          {/* The selected table: beside the plan, or a sheet from the bottom on a phone */}
          {!wide && sel ? (
            <>
              <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setSelected(null)} />
              <div className="fixed inset-x-0 bottom-0 z-50 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 pb-8 shadow-2xl">
                <div className="mb-2 flex items-center justify-between">
                  <span className="mx-auto h-1 w-10 rounded-full bg-border" />
                  <button type="button" onClick={() => setSelected(null)} aria-label="Close" className="absolute right-3 top-3 h-9 w-9 rounded-full text-lg text-muted-foreground hover:bg-surface-hover">✕</button>
                </div>
                <TablePanel key={sel.id} t={sel} canEdit={canEdit} busy={busy} onUpdate={(c) => update(sel, c)} onDelete={() => remove(sel)} />
              </div>
            </>
          ) : null}
          <div className={`rounded-2xl border border-border bg-surface p-4 self-start ${!wide && sel ? "hidden" : ""}`}>
            {!sel ? (
              <p className="text-sm text-muted-foreground">
                {canEdit ? "Tap a table to change its number or seats." : "Tap a table to see its details."}
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
  onUpdate: (c: Partial<Pick<Table, "table_number" | "capacity">>) => void; onDelete: () => void;
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

      {canEdit && (
        <button type="button" onClick={onDelete} disabled={busy} className="mt-5 w-full rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
          Delete table
        </button>
      )}
    </div>
  );
}
