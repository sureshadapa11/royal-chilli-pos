// The restaurant floor plan (Staff Hub → Tables, and the till's table
// screen): one floor of equal table slots in neat rows and columns, measured
// in grid cells. Every table is the same size and sits in one slot — pos_x /
// pos_y is the top-left of its slot. Seats are shown as a number, not by
// size. Safe to import in the browser.

export const SHAPES = ["square", "round", "rect"] as const;
export type Shape = (typeof SHAPES)[number];

/** One slot is SLOT cells wide and deep; the table fills all but a cell of gap. */
export const SLOT = 8;
export const TABLE_SIZE = 7;
/** The floor, in slots. */
export const COLS = 6;
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

/** The slot nearest to a table whose top-left is at (x, y). */
export function nearestSlot(x: number, y: number): { col: number; row: number } {
  return {
    col: clamp(Math.round((x - 1) / SLOT), 0, COLS - 1),
    row: clamp(Math.round((y - 1) / SLOT), 0, ROWS - 1),
  };
}

const key = (col: number, row: number) => `${col},${row}`;

/** The first empty slot, row by row. */
export function freeSlot(taken: Set<string>): { col: number; row: number } {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) if (!taken.has(key(col, row))) return { col, row };
  }
  return { col: 0, row: ROWS }; // the floor is full: below it
}

const tableNo = (t: PlanTable) => parseInt(t.table_number.replace(/\D/g, ""), 10) || 0;

/** The till's old layout, by table-number order: the first 9 as a 3×3 block
 *  read column by column (T3 T6 T9 / T2 T5 T8 / T1 T4 T7), the rest in rows
 *  of 4 underneath. */
export function legacySlot(index: number): { col: number; row: number } {
  if (index < 9) return { col: Math.floor(index / 3), row: 2 - (index % 3) };
  const i = index - 9;
  return { col: i % 4, row: 3 + Math.floor(i / 4) };
}

/** Every table in a slot — saved ones in the slot nearest their saved spot,
 *  the rest like the till's old layout. Two tables never share a slot: a
 *  later one (by number) moves to the first empty slot. */
export function placeTables<T extends PlanTable>(tables: T[]): Placed<T>[] {
  const sorted = [...tables].sort((a, b) => tableNo(a) - tableNo(b));
  const taken = new Set<string>();
  const out: Placed<T>[] = [];
  const put = (t: T, s: { col: number; row: number }) => {
    if (taken.has(key(s.col, s.row)) || s.row >= ROWS) s = freeSlot(taken);
    taken.add(key(s.col, s.row));
    const { x, y } = slotXY(s.col, s.row);
    out.push({ ...t, ...s, x, y, w: TABLE_SIZE, h: TABLE_SIZE, box: { x, y, w: TABLE_SIZE, h: TABLE_SIZE } });
  };
  const saved = sorted.filter((t) => t.pos_x != null && t.pos_y != null);
  for (const t of saved) put(t, nearestSlot(Number(t.pos_x), Number(t.pos_y)));
  sorted.forEach((t, i) => { if (t.pos_x == null || t.pos_y == null) put(t, legacySlot(i)); });
  return out;
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
