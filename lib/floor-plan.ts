// The restaurant floor plan (Staff Hub → Tables, and the till's table
// screen): one floor of equal table slots in neat rows and columns, measured
// in grid cells. Every table is the same size and sits in one slot — pos_x /
// pos_y is the top-left of its slot. One even grid: whole columns and rows,
// the same gap everywhere. Seats are shown as a number, not by size. Safe to
// import in the browser.

export const SHAPES = ["square", "round", "rect"] as const;
export type Shape = (typeof SHAPES)[number];

/** One slot is SLOT cells wide and deep; the table fills all but a cell of gap. */
export const SLOT = 8;
export const TABLE_SIZE = 7;
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
  const put = (t: T, s: Slot) => {
    if (s.row >= ROWS || s.col > COLS - 1 || taken.some((q) => clashes(q, s))) s = freeSlot(taken);
    taken.push(s);
    const { x, y } = slotXY(s.col, s.row);
    out.push({ ...t, ...s, x, y, w: TABLE_SIZE, h: TABLE_SIZE, box: { x, y, w: TABLE_SIZE, h: TABLE_SIZE } });
  };
  const saved = sorted.filter((t) => t.pos_x != null && t.pos_y != null);
  for (const t of saved) put(t, nearestSlot(Number(t.pos_x), Number(t.pos_y)));
  sorted.forEach((t, i) => { if (t.pos_x == null || t.pos_y == null) put(t, legacySlot(i)); });
  return out;
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

/** Where `tableId` goes to join the group led by `leadId`: the next slot along
 *  the group's line (right, left, below, above for a table on its own). A
 *  table already there swaps into `tableId`'s old slot. */
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

  const cols = group.members.map((m) => m.col), rows = group.members.map((m) => m.row);
  const [c0, c1, r0, r1] = [Math.min(...cols), Math.max(...cols), Math.min(...rows), Math.max(...rows)];
  const across = { right: { col: c1 + 1, row: r0 }, left: { col: c0 - 1, row: r0 } };
  const down = { below: { col: c0, row: r1 + 1 }, above: { col: c0, row: r0 - 1 } };
  const candidates = group.members.length === 1
    ? [across.right, across.left, down.below, down.above]
    : r0 === r1 ? [across.right, across.left] : [down.below, down.above];

  const inTheWay = (s: Slot) => placed.filter((p) => p.id !== tableId && clashes(p, s));
  const usable = candidates.filter((s) => {
    if (s.col < 0 || s.col > COLS - 1 || s.row < 0 || s.row >= ROWS) return false;
    const there = inTheWay(s);
    // Only one table on its own can be swapped out of the way.
    return there.length === 0 || (there.length === 1 && groups.find((g) => g.members.some((m) => m.id === there[0].id))!.members.length === 1);
  });
  if (usable.length === 0) return { error: "There's no room beside those tables — move them, then join" };
  // Already in place? Nothing moves.
  const to = usable.find((s) => s.col === joining.col && s.row === joining.row) ?? usable[0];
  if (to.col === joining.col && to.row === joining.row) return { moves: [] };
  const moves = [{ id: tableId, ...slotXY(to.col, to.row) }];
  const [there] = inTheWay(to);
  if (there) moves.push({ id: there.id, ...slotXY(joining.col, joining.row) });
  return { moves };
}
