"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { confirmDelete } from "@/components/ui/confirm";
import {
  COLS, GRID_W, ROWS, SLOT, TABLE_SIZE, clashes, freeSlot, groupsOf, joinLabel, nearestSlot, placeTables, rowsShown, slotXY,
  type Group, type Placed,
} from "@/lib/floor-plan";

// Staff Hub → Tables: the restaurant's floor plan — equal tables in rows and
// columns of slots. Drag a table to an empty slot, or onto another table to
// swap the two (it saves when you let go); tap one to change its number or
// seats, join it to other tables, or delete it. Joined tables (pushed
// together for a big party) are drawn as one long table, "T1 + T2", and act
// as one on the till — one order, one bill — until unjoined here. The till's
// table screen draws the same plan. Read-only without full Tables access. On
// a phone, "Move tables" switches dragging on (otherwise a finger scrolls the
// page), the plan can be zoomed, and a tapped table opens in a sheet from the
// bottom.

type Table = {
  id: number;
  table_number: string;
  capacity: number;
  status: "available" | "occupied" | "reserved";
  pos_x: number | null;
  pos_y: number | null;
  joined_to: number | null;
  group_name: string | null;
};
type Spot = Placed<Table>;

const STATUS: Record<Table["status"], { label: string; fill: string; ring: string }> = {
  available: { label: "Free", fill: "bg-white", ring: "border-emerald-500/60" },
  occupied: { label: "Occupied", fill: "bg-red-50", ring: "border-red-400" },
  reserved: { label: "Reserved", fill: "bg-amber-50", ring: "border-amber-400" },
};

const GROUP_NAMES = ["🎂 Birthday party", "💼 Office party", "👨‍👩‍👧 Family dinner", "💍 Anniversary", "👥 Large group"];

const heading = { fontFamily: "var(--font-space-grotesk)" };
const label = "text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground";

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
  const groups = useMemo(() => groupsOf(placed), [placed]);
  const groupOf = (id: number) => groups.find((g) => g.members.some((m) => m.id === id))!;
  const isJoined = (id: number) => groupOf(id).members.length > 1;
  const target = drag ? nearestSlot(drag.x, drag.y) : null;
  const taken = placed.map((p) => ({ col: p.col, row: p.row }));
  // Only the rows in use plus one spare, so the floor fits on the screen.
  const showRows = rowsShown(placed);
  const GRID_H = showRows * SLOT + 1;
  const selGroup = selected != null ? groups.find((g) => g.lead.id === selected) ?? null : null;
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
    // A plain tap selects (see onPointerUp); with dragging off, or on joined
    // tables (unjoin them to move them), select now.
    if (!canDrag || isJoined(t.id)) { setSelected(groupOf(t.id).lead.id); return; }
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
    const inTheWay = placed.filter((p) => p.id !== t.id && clashes(p, to));
    if (inTheWay.length > 1) {
      toast({ variant: "destructive", title: "No room there", description: "Drop it in a free spot, or onto one table to swap them." });
      return;
    }
    const [there] = inTheWay;
    if (there && isJoined(there.id)) {
      toast({ variant: "destructive", title: `${joinLabel(groupOf(there.id).members)} are joined`, description: "Drop it in a free spot, or unjoin those tables first." });
      return;
    }
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

  // ---- joining --------------------------------------------------------------
  // `pick` is another group's lead (a lone table is its own lead). A lone
  // table joins onto `g`; picking a joined group joins `g`'s lone table onto it.
  async function join(g: Group<Table>, pick: number) {
    const other = groups.find((x) => x.lead.id === pick);
    if (!other) return;
    const [leadId, tableId] = other.members.length > 1 ? [other.lead.id, g.lead.id] : [g.lead.id, other.lead.id];
    const data = await call("/api/tables/join", "POST", { lead_id: leadId, table_id: tableId });
    if (data) {
      setSelected(data.lead_id);
      toast({ variant: "success", title: "Tables joined", description: "They're one table on the till now — one order, one bill." });
    }
  }

  async function unjoin(g: Group<Table>) {
    if (await call(`/api/tables/join?lead_id=${g.lead.id}`, "DELETE")) {
      toast({ title: `${joinLabel(g.members)} unjoined`, description: "They're separate tables again." });
    }
  }

  async function nameGroup(g: Group<Table>, name: string) {
    await call("/api/tables/join", "PUT", { lead_id: g.lead.id, group_name: name }, true);
  }

  const panel = selGroup && (
    selGroup.members.length > 1 ? (
      <GroupPanel key={`g${selGroup.lead.id}`} g={selGroup} canEdit={canEdit} busy={busy}
        joinable={groups.filter((x) => x.members.length === 1)}
        onJoin={(pick) => join(selGroup, pick)} onUnjoin={() => unjoin(selGroup)} onName={(n) => nameGroup(selGroup, n)} />
    ) : (
      <TablePanel key={selGroup.lead.id} t={selGroup.lead} canEdit={canEdit} busy={busy}
        joinable={groups.filter((x) => x.lead.id !== selGroup.lead.id)}
        onUpdate={(c) => update(selGroup.lead, c)} onDelete={() => remove(selGroup.lead)} onJoin={(pick) => join(selGroup, pick)} />
    )
  );

  return (
    <div className="px-4 py-6 md:px-6">
      <div className="mx-auto max-w-[1240px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 style={heading} className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">Tables</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {tables.length} table{tables.length === 1 ? "" : "s"} · {totalSeats} seats
              {canDrag ? " · drag a table to a free spot, or onto another to swap · tap to edit or join" : canEdit ? " · tap a table to edit or join it, or turn on Move tables" : ""}
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

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_300px]">
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
              <div className={!wide && zoom > 1 ? "overflow-auto rounded-xl" : "mx-auto"}
                // On a computer, never taller than the screen: the width follows the height.
                style={wide ? { maxWidth: `calc((100vh - 230px) * ${GRID_W} / ${GRID_H})` } : undefined}>
              <div
                ref={canvasRef}
                onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
                className="relative select-none rounded-xl bg-[#FBF8F1]"
                style={{
                  width: !wide ? `${zoom * 100}%` : "100%",
                  aspectRatio: `${GRID_W} / ${GRID_H}`,
                }}
              >
                {/* Empty slots while tables can be moved; where a dragged table would land is lit */}
                {canDrag && [
                  ...Array.from({ length: COLS * showRows }, (_, i) => ({ col: i % COLS, row: Math.floor(i / COLS), lit: false }))
                    .filter((s) => !taken.some((q) => clashes(q, s))),
                  ...(target ? [{ ...target, lit: true }] : []),
                ].map((s) => {
                  const { x, y } = slotXY(s.col, s.row);
                  return (
                    <div key={`slot-${s.col}-${s.row}-${s.lit}`} aria-hidden
                      className={`pointer-events-none absolute rounded-lg border-2 border-dashed ${s.lit ? "border-blue-400 bg-blue-50/60" : "border-[#E6DDCB]"}`}
                      style={{ left: `${(x / GRID_W) * 100}%`, top: `${(y / GRID_H) * 100}%`, width: `${(TABLE_SIZE / GRID_W) * 100}%`, height: `${(TABLE_SIZE / GRID_H) * 100}%` }} />
                  );
                })}
                {groups.map((g) => {
                  const t = g.lead;
                  const joined = g.members.length > 1;
                  const st = STATUS[t.status] ?? STATUS.available;
                  const isSel = t.id === selected;
                  const dragging = drag?.id === t.id;
                  const b = dragging ? { x: drag.x, y: drag.y, w: t.w, h: t.h } : g.box;
                  const name = joined ? t.group_name?.trim() : null;
                  const seats = g.members.reduce((s, m) => s + m.capacity, 0);
                  const movable = canDrag && !joined;
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      aria-label={joined ? `Joined tables ${joinLabel(g.members)}, ${seats} seats` : `Table ${t.table_number}, ${seats} seats`}
                      onPointerDown={(e) => onPointerDown(e, t)}
                      onPointerMove={(e) => onPointerMove(e, t)}
                      onPointerUp={(e) => onPointerUp(e, t)}
                      onPointerCancel={() => { dragStart.current = null; setDrag(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") setSelected(t.id); }}
                      className={`absolute flex flex-col items-center justify-center border-2 ${st.fill} ${isSel ? "border-blue-500 ring-2 ring-blue-400/40" : st.ring} rounded-lg ${movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${dragging ? "z-10 opacity-90 shadow-lg" : "shadow-sm"} ${movable ? "touch-none" : "touch-manipulation"} transition-[box-shadow]`}
                      style={{
                        left: `${(b.x / GRID_W) * 100}%`, top: `${(b.y / GRID_H) * 100}%`,
                        width: `${(b.w / GRID_W) * 100}%`, height: `${(b.h / GRID_H) * 100}%`,
                      }}
                    >
                      {/* Where one table meets the next, a faint seam */}
                      {joined && g.members.map((m) => {
                        const across = g.box.h <= TABLE_SIZE + 0.01;
                        const at = across ? (m.box.x - g.box.x - 0.5) / g.box.w : (m.box.y - g.box.y - 0.5) / g.box.h;
                        const prev = g.members.some((o) => (across ? o.col === m.col - 1 : o.row === m.row - 1));
                        return prev ? (
                          <span key={m.id} aria-hidden className="pointer-events-none absolute border-dashed border-current opacity-20"
                            style={across ? { left: `${at * 100}%`, top: "12%", bottom: "12%", borderLeftWidth: 1 } : { top: `${at * 100}%`, left: "12%", right: "12%", borderTopWidth: 1 }} />
                        ) : null;
                      })}
                      <span className="flex max-w-full flex-col items-center px-1 text-center">
                        <span className="text-[clamp(11px,1.4vw,17px)] font-black leading-none text-foreground">{joined ? joinLabel(g.members) : t.table_number}</span>
                        {name && <span className="mt-0.5 max-w-full truncate text-[clamp(9px,0.9vw,12px)] font-semibold text-foreground/80">{name}</span>}
                        <span className="mt-0.5 text-[clamp(9px,0.9vw,11px)] text-muted-foreground">{seats} seats</span>
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
          {!wide && panel ? (
            <>
              <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setSelected(null)} />
              <div className="fixed inset-x-0 bottom-0 z-50 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 pb-8 shadow-2xl">
                <div className="mb-2 flex items-center justify-between">
                  <span className="mx-auto h-1 w-10 rounded-full bg-border" />
                  <button type="button" onClick={() => setSelected(null)} aria-label="Close" className="absolute right-3 top-3 h-9 w-9 rounded-full text-lg text-muted-foreground hover:bg-surface-hover">✕</button>
                </div>
                {panel}
              </div>
            </>
          ) : null}
          <div className={`rounded-2xl border border-border bg-surface p-4 self-start ${!wide && panel ? "hidden" : ""}`}>
            {panel || (
              <p className="text-sm text-muted-foreground">
                {canEdit ? "Tap a table to change its number or seats, or to join it to other tables." : "Tap a table to see its details."}
              </p>
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

/** "Join with…": every other table (or joined group) to pick from. */
function JoinPicker({ options, busy, onJoin, prompt }: {
  options: Group<Table>[]; busy: boolean; onJoin: (leadId: number) => void; prompt: string;
}) {
  const sorted = [...options].sort((a, b) => a.lead.table_number.localeCompare(b.lead.table_number, undefined, { numeric: true }));
  if (sorted.length === 0) return null;
  return (
    <select value="" disabled={busy} onChange={(e) => { if (e.target.value) onJoin(Number(e.target.value)); }}
      className="mt-1 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm font-semibold text-foreground disabled:opacity-60">
      <option value="">{prompt}</option>
      {sorted.map((g) => (
        <option key={g.lead.id} value={g.lead.id}>
          {g.members.length > 1 ? joinLabel(g.members, g.lead.group_name) : g.lead.table_number}
          {g.lead.status === "available" ? "" : ` (${STATUS[g.lead.status]?.label.toLowerCase() ?? g.lead.status})`}
        </option>
      ))}
    </select>
  );
}

function TablePanel({ t, canEdit, busy, joinable, onUpdate, onDelete, onJoin }: {
  t: Spot; canEdit: boolean; busy: boolean; joinable: Group<Table>[];
  onUpdate: (c: Partial<Pick<Table, "table_number" | "capacity">>) => void; onDelete: () => void; onJoin: (leadId: number) => void;
}) {
  const [number, setNumber] = useState(t.table_number);
  const saveNumber = () => { const n = number.trim(); if (n && n !== t.table_number) onUpdate({ table_number: n }); else setNumber(t.table_number); };
  return (
    <div>
      <p className={label}>Table</p>
      <input value={number} onChange={(e) => setNumber(e.target.value)} disabled={!canEdit || busy}
        onBlur={saveNumber} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="mt-1 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-lg font-bold text-foreground disabled:opacity-80" />

      <p className={`${label} mt-4`}>Seats</p>
      <div className="mt-1 flex items-center gap-3">
        <button type="button" onClick={() => onUpdate({ capacity: t.capacity - 1 })} disabled={!canEdit || busy || t.capacity <= 1}
          className="h-10 w-10 rounded-full border border-border text-xl font-bold hover:bg-surface-hover disabled:opacity-40">−</button>
        <span className="min-w-[2ch] text-center text-2xl font-bold tabular-nums">{t.capacity}</span>
        <button type="button" onClick={() => onUpdate({ capacity: t.capacity + 1 })} disabled={!canEdit || busy || t.capacity >= 30}
          className="h-10 w-10 rounded-full border border-border text-xl font-bold hover:bg-surface-hover disabled:opacity-40">+</button>
      </div>

      {canEdit && joinable.length > 0 && (
        <>
          <p className={`${label} mt-4`}>Join tables</p>
          <JoinPicker options={joinable} busy={busy} onJoin={onJoin} prompt={`Join ${t.table_number} with…`} />
          <p className="mt-1 text-xs text-muted-foreground">For a big party: the tables move side by side and act as one on the till — one order, one bill.</p>
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

function GroupPanel({ g, canEdit, busy, joinable, onJoin, onUnjoin, onName }: {
  g: Group<Table>; canEdit: boolean; busy: boolean; joinable: Group<Table>[];
  onJoin: (leadId: number) => void; onUnjoin: () => void; onName: (name: string) => void;
}) {
  const [name, setName] = useState(g.lead.group_name ?? "");
  const saveName = (n: string) => { if (n.trim() !== (g.lead.group_name ?? "").trim()) onName(n.trim()); };
  const seats = g.members.reduce((s, m) => s + m.capacity, 0);
  return (
    <div>
      <p className={label}>Joined tables</p>
      <p className="mt-1 text-2xl font-black text-foreground">{joinLabel(g.members)}</p>
      <p className="text-sm text-muted-foreground">
        {seats} seats · one table on the till · orders go on {g.lead.table_number}
      </p>

      <p className={`${label} mt-4`}>Group name <span className="normal-case tracking-normal">(optional)</span></p>
      <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit || busy} maxLength={40}
        placeholder="e.g. Sarah's birthday"
        onBlur={() => saveName(name)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="mt-1 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm font-semibold text-foreground disabled:opacity-80" />
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {GROUP_NAMES.map((n) => (
            <button key={n} type="button" disabled={busy} onClick={() => { setName(n); saveName(n); }}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${name === n ? "border-red-500 bg-red-50 text-red-700" : "border-border hover:bg-surface-hover"} disabled:opacity-60`}>
              {n}
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-muted-foreground">Shows on the till, the kitchen ticket and the receipt.</p>

      {canEdit && joinable.length > 0 && (
        <>
          <p className={`${label} mt-4`}>Add a table</p>
          <JoinPicker options={joinable} busy={busy} onJoin={onJoin} prompt="Join another table…" />
        </>
      )}

      {canEdit && (
        <>
          <button type="button" onClick={onUnjoin} disabled={busy}
            className="mt-5 w-full rounded-lg border border-border px-3 py-2 text-sm font-bold text-foreground hover:bg-surface-hover disabled:opacity-50">
            Unjoin tables
          </button>
          <p className="mt-1 text-xs text-muted-foreground">Unjoin to move, rename or delete these tables. Not while they have an open order.</p>
        </>
      )}
    </div>
  );
}
