// The restaurant floor plan (Staff Hub → Tables, and the till's table
// screen): one floor on a grid of cells. Each table sits at (pos_x, pos_y) —
// its top-left cell — and its size follows its seats and shape, so an
// 8-seater is drawn bigger than a 2-seater. Safe to import in the browser.

export const SHAPES = ["square", "round", "rect"] as const;
export type Shape = (typeof SHAPES)[number];
export const SHAPE_LABEL: Record<Shape, string> = { square: "Square", round: "Round", rect: "Long" };

/** The editor's canvas, in cells. */
export const GRID_W = 36;
export const GRID_H = 34;

export type PlanTable = {
  id: number;
  table_number: string;
  capacity: number;
  pos_x?: number | null;
  pos_y?: number | null;
  shape?: Shape | null;
};
export type Placed<T extends PlanTable> = T & { x: number; y: number; w: number; h: number; shape: Shape };

/** Size in cells: grows with the seats; a long table is wider and shallower. */
export function footprint(capacity: number, shape: Shape | null | undefined): { w: number; h: number } {
  const base = capacity <= 2 ? 4 : capacity <= 4 ? 5 : capacity <= 6 ? 6 : capacity <= 8 ? 7 : 8;
  return shape === "rect" ? { w: base + 2, h: base - 1 } : { w: base, h: base };
}

const tableNo = (t: PlanTable) => parseInt(t.table_number.replace(/\D/g, ""), 10) || 0;

/** Where a table goes when it has no saved position: the till's old layout —
 *  the first 9 tables (by number) as a 3×3 block read column by column, the
 *  rest in a row of 4 underneath. */
function legacySpot(index: number): { x: number; y: number } {
  if (index < 9) {
    const col = Math.floor(index / 3);
    const row = 2 - (index % 3);
    return { x: 1 + col * 8, y: 1 + row * 8 };
  }
  const i = index - 9;
  return { x: 1 + (i % 4) * 8, y: 25 + Math.floor(i / 4) * 8 };
}

export const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A free spot for a new w×h table: scans row by row, leaving a cell of space. */
export function freeSpot(placed: { x: number; y: number; w: number; h: number }[], w: number, h: number): { x: number; y: number } {
  for (let y = 1; y + h <= GRID_H; y++) {
    for (let x = 1; x + w <= GRID_W; x++) {
      const box = { x: x - 1, y: y - 1, w: w + 2, h: h + 2 };
      if (!placed.some((p) => overlaps(box, p))) return { x, y };
    }
  }
  return { x: 1, y: 1 };
}

/** Every table with a position and size — saved ones as saved, the rest
 *  placed like the till's old layout (or in a free spot if that's taken). */
export function placeTables<T extends PlanTable>(tables: T[]): Placed<T>[] {
  const out: Placed<T>[] = [];
  const unsaved: T[] = [];
  for (const t of tables) {
    const shape: Shape = t.shape && (SHAPES as readonly string[]).includes(t.shape) ? t.shape : "square";
    const { w, h } = footprint(t.capacity, shape);
    if (t.pos_x != null && t.pos_y != null) out.push({ ...t, x: t.pos_x, y: t.pos_y, w, h, shape });
    else unsaved.push(t);
  }
  const allSorted = [...tables].sort((a, b) => tableNo(a) - tableNo(b));
  for (const t of unsaved.sort((a, b) => tableNo(a) - tableNo(b))) {
    const shape: Shape = t.shape && (SHAPES as readonly string[]).includes(t.shape) ? t.shape : "square";
    const { w, h } = footprint(t.capacity, shape);
    let spot = legacySpot(allSorted.indexOf(t));
    if (out.some((p) => overlaps({ ...spot, w, h }, p))) spot = freeSpot(out, w, h);
    out.push({ ...t, ...spot, w, h, shape });
  }
  return out;
}

/** The part of the grid the tables actually use (for the till, which shows
 *  just that, scaled to fit). */
export function usedBox(placed: { x: number; y: number; w: number; h: number }[]) {
  if (placed.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.min(...placed.map((p) => p.x));
  const y = Math.min(...placed.map((p) => p.y));
  const r = Math.max(...placed.map((p) => p.x + p.w));
  const b = Math.max(...placed.map((p) => p.y + p.h));
  return { x, y, w: r - x, h: b - y };
}
