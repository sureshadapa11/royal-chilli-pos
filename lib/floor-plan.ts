// Shared floor-plan geometry for Staff Hub and the till. Coordinates and
// dimensions use floor units; saved positions can be fractional.

export const SHAPES = ["square", "round", "rect"] as const;
export type Shape = (typeof SHAPES)[number];

/** One slot is SLOT cells wide and deep; the table fills all but a cell of gap. */
export const SLOT = 8;
export const TABLE_SIZE = 7;
export const MIN_TABLE_SIZE = 4;
export const MAX_TABLE_SIZE = 12;
/** The floor, in slots. */
export const COLS = 5;
export const ROWS = 5;
/** The floor, in cells (a cell of margin round the edge). */
export const GRID_W = COLS * SLOT + 1;
export const GRID_H = ROWS * SLOT + 1;

export type PlanTable = {
  id: number;
  table_number: string;
  capacity: number;
  shape?: Shape | null;
  width?: number | string | null;
  depth?: number | string | null;
  pos_x?: number | string | null;
  pos_y?: number | string | null;
  /** Joined onto this lead table (see "Joined tables" below). */
  joined_to?: number | null;
  group_name?: string | null;
};

/** The space a table takes on the floor. */
export type Box = { x: number; y: number; w: number; h: number };

export type Placed<T extends PlanTable> = T & {
  col: number; row: number;
  x: number; y: number; w: number; h: number;
  box: Box;
};

/** Top-left cell of a slot. */
export const slotXY = (col: number, row: number) => ({ x: 1 + col * SLOT, y: 1 + row * SLOT });

export const round2 = (n: number) => Math.round(n * 100) / 100;

const clamp =(n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export type Slot = { col: number; row: number };

/** The slot nearest to a table whose top-left is at (x, y). */
export function nearestSlot(x: number, y: number): Slot {
  return {
    col: clamp(Math.round((x - 1) / SLOT), 0, COLS - 1),
    row: clamp(Math.round((y - 1) / SLOT), 0, ROWS - 1),
  };
}

/** Two tables in these slots would overlap. */
export const clashes = (a: Slot, b: Slot) => a.row === b.row && Math.abs(a.col - b.col) < 0.99;

/** The first empty whole slot, row by row. */
export function freeSlot(taken: Slot[]): Slot {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) if (!taken.some((t) => clashes(t, { col, row }))) return { col, row };
  }
  return { col: 0, row: ROWS }; // the floor is full: below it
}

const tableNo = (t: PlanTable) => parseInt(t.table_number.replace(/\D/g, ""), 10) || 0;

/** The till's old layout, by table-number order: the first 9 as a 3×3 block
 *  read column by column (T3 T6 T9 / T2 T5 T8 / T1 T4 T7), the rest in rows
 *  of 4 underneath — all on the same even grid. */
export function legacySlot(index: number): Slot {
  if (index < 9) return { col: Math.floor(index / 3), row: 2 - (index % 3) };
  const i = index - 9;
  return { col: i % 4, row: 3 + Math.floor(i / 4) };
}

/** Every table in a slot — saved ones in the slot nearest their saved spot,
 *  the rest like the till's old layout. Two tables never share a slot: a
 *  later one (by number) moves to the first empty slot. */
export function placeTables<T extends PlanTable>(tables: T[]): Placed<T>[] {
  const sorted = [...tables].sort((a, b) => tableNo(a) - tableNo(b));
  const taken: Slot[] = [];
  const out: Placed<T>[] = [];
  const put = (t: T, s: Slot, saved = false) => {
    const w = dimension(t.width), h = dimension(t.depth);
    let x = saved && t.pos_x != null ? Number(t.pos_x) : slotXY(s.col, s.row).x;
    let y = saved && t.pos_y != null ? Number(t.pos_y) : slotXY(s.col, s.row).y;
    x = clamp(x, 0, GRID_W - w); y = clamp(y, 0, GRID_H - h);
    if (out.some((p) => boxesOverlap(p.box, { x, y, w, h }))) {
      const free = firstFreePosition(out, w, h);
      x = free.x; y = free.y;
    }
    const col = Math.round((x - 1) / SLOT), row = Math.round((y - 1) / SLOT);
    out.push({ ...t, col, row, x, y, w, h, box: { x, y, w, h } });
  };
  const saved = sorted.filter((t) => t.pos_x != null && t.pos_y != null);
  for (const t of saved) put(t, nearestSlot(Number(t.pos_x), Number(t.pos_y)), true);
  sorted.forEach((t, i) => { if (t.pos_x == null || t.pos_y == null) put(t, legacySlot(i)); });
  return out;
}

export function dimension(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, MIN_TABLE_SIZE, MAX_TABLE_SIZE) : TABLE_SIZE;
}

export function boxesOverlap(a: Box, b: Box, gap = 0.5): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

export function firstFreePosition(placed: { box: Box }[], w = TABLE_SIZE, h = TABLE_SIZE): { x: number; y: number } {
  for (let y = 1; y + h <= GRID_H; y += 0.5) {
    for (let x = 1; x + w <= GRID_W; x += 0.5) {
      if (!placed.some((p) => boxesOverlap(p.box, { x, y, w, h }))) return { x, y };
    }
  }
  return { x: 1, y: 1 };
}

/** How many rows of the floor to show: the rows in use plus one spare to
 *  drag a table into (never more than the floor has). */
export function rowsShown(placed: { row: number }[]): number {
  const last = placed.length ? Math.max(...placed.map((p) => p.row)) : -1;
  return Math.min(ROWS, Math.max(2, last + 2));
}

/** The part of the floor the tables actually use (for the till, which shows
 *  just that, scaled to fit). */
export function usedBox(placed: { box: Box }[]): Box {
  if (placed.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.min(...placed.map((p) => p.box.x));
  const y = Math.min(...placed.map((p) => p.box.y));
  const r = Math.max(...placed.map((p) => p.box.x + p.box.w));
  const b = Math.max(...placed.map((p) => p.box.y + p.box.h));
  return { x, y, w: r - x, h: b - y };
}

// ---- Joined tables ---------------------------------------------------------
// Tables pushed together for a big party are joined in Staff Hub → Tables
// and act as one table — one order and bill, on the lead table — until
// unjoined. A group sits in a straight line of slots (side by side, or one
// behind the other), so it's drawn as one long table.

export type Group<T extends PlanTable> = {
  lead: Placed<T>;
  /** Lead first, then the rest in slot order. */
  members: Placed<T>[];
  /** The whole group's outline on the floor. */
  box: Box;
};

/** Each table on its own, or a joined group, as the plan draws it. */
export function groupsOf<T extends PlanTable>(placed: Placed<T>[]): Group<T>[] {
  const byId = new Map(placed.map((p) => [p.id, p]));
  const leadOf = (p: Placed<T>) => (p.joined_to != null && byId.has(p.joined_to) ? byId.get(p.joined_to)! : p);
  const out = new Map<number, Group<T>>();
  for (const p of placed) {
    const lead = leadOf(p);
    const g = out.get(lead.id) ?? { lead, members: [lead], box: lead.box };
    if (p !== lead) g.members.push(p);
    out.set(lead.id, g);
  }
  for (const g of out.values()) {
    const rest = g.members.slice(1).sort((a, b) => a.row - b.row || a.col - b.col);
    g.members = [g.lead, ...rest];
    g.box = usedBox(g.members);
  }
  return [...out.values()];
}

/** "T1 + T2", by table number, plus " · <group name>" when there is one. */
export function joinLabel(members: PlanTable[], groupName?: string | null): string {
  const nums = [...members].sort((a, b) => tableNo(a) - tableNo(b)).map((m) => m.table_number).join(" + ");
  const name = groupName?.trim();
  return name ? `${nums} · ${name}` : nums;
}

/** Place a table beside a group, respecting each table's actual footprint. */
export function planJoin<T extends PlanTable>(
  placed: Placed<T>[], leadId: number, tableId: number,
): { moves: { id: number; x: number; y: number }[] } | { error: string } {
  const groups = groupsOf(placed);
  const group = groups.find((g) => g.lead.id === leadId);
  const joining = placed.find((p) => p.id === tableId);
  if (!group || !joining) return { error: "That table isn't on the plan" };
  if (group.members.some((m) => m.id === tableId)) return { error: "Those tables are already joined" };
  const own = groups.find((g) => g.members.some((m) => m.id === tableId))!;
  if (own.members.length > 1) return { error: `${joining.table_number} is joined to other tables — unjoin it first` };

  const across = group.box.w >= group.box.h;
  const candidates = group.members.length === 1 || across
    ? [
        { x: group.box.x + group.box.w + 1, y: group.box.y },
        { x: group.box.x - joining.w - 1, y: group.box.y },
        ...(group.members.length === 1 ? [
          { x: group.box.x, y: group.box.y + group.box.h + 1 },
          { x: group.box.x, y: group.box.y - joining.h - 1 },
        ] : []),
      ]
    : [
        { x: group.box.x, y: group.box.y + group.box.h + 1 },
        { x: group.box.x, y: group.box.y - joining.h - 1 },
      ];
  const usable = candidates.flatMap((s) => {
    const box = { ...s, w: joining.w, h: joining.h };
    if (s.x < 0 || s.y < 0 || s.x + joining.w > GRID_W || s.y + joining.h > GRID_H) return [];
    const blockers = placed.filter((p) => p.id !== tableId && boxesOverlap(p.box, box));
    if (blockers.length === 0) return [{ ...s, swapId: null as number | null }];
    if (blockers.length !== 1) return [];
    const there = blockers[0];
    const thereGroup = groups.find((g) => g.members.some((m) => m.id === there.id));
    if (!thereGroup || thereGroup.members.length !== 1) return [];
    const swapBox = { x: joining.x, y: joining.y, w: there.w, h: there.h };
    if (swapBox.x + swapBox.w > GRID_W || swapBox.y + swapBox.h > GRID_H) return [];
    if (placed.some((p) => p.id !== tableId && p.id !== there.id && boxesOverlap(p.box, swapBox))) return [];
    return [{ ...s, swapId: there.id }];
  });
  if (usable.length === 0) return { error: "There's no room beside those tables — move them, then join" };
  // Already in place? Nothing moves.
  const to = usable.find((s) => s.x === joining.x && s.y === joining.y) ?? usable[0];
  if (to.x === joining.x && to.y === joining.y) return { moves: [] };
  const moves = [{ id: tableId, x: to.x, y: to.y }];
  if (to.swapId != null) moves.push({ id: to.swapId, x: joining.x, y: joining.y });
  return { moves };
}
