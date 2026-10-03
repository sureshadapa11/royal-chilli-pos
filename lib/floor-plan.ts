// The restaurant floor plan (Staff Hub → Tables, and the till's table
// screen): one floor, measured in grid cells. Each table sits at (pos_x,
// pos_y) — the top-left of its upright footprint, anywhere (fractions of a
// cell allowed) — turned by `rotation` degrees (45° steps) about its centre.
// Its size follows its seats and shape, so an 8-seater is drawn bigger than a
// 2-seater. Safe to import in the browser.

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
  pos_x?: number | string | null;
  pos_y?: number | string | null;
  shape?: Shape | null;
  rotation?: number | null;
};

/** The space a table takes on the floor once turned (axis-aligned). */
export type Box = { x: number; y: number; w: number; h: number };

export type Placed<T extends PlanTable> = T & {
  x: number; y: number; w: number; h: number; shape: Shape; rotation: number;
  /** Its outline on the floor, after turning. */
  box: Box;
};

/** Size in cells: grows with the seats; a long table is wider and shallower. */
export function footprint(capacity: number, shape: Shape | null | undefined): { w: number; h: number } {
  const base = capacity <= 2 ? 4 : capacity <= 4 ? 5 : capacity <= 6 ? 6 : capacity <= 8 ? 7 : 8;
  return shape === "rect" ? { w: base + 2, h: base - 1 } : { w: base, h: base };
}

/** Round tables look the same however they're turned. */
export const effectiveRotation = (shape: Shape, rotation: number | null | undefined) =>
  shape === "round" ? 0 : (((Math.round((rotation ?? 0) / 45) * 45) % 360) + 360) % 360;

/** The outline of a w×h table at (x, y), turned about its centre. */
export function outline(x: number, y: number, w: number, h: number, rotation: number): Box {
  const r = (rotation * Math.PI) / 180;
  const bw = Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r));
  const bh = Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r));
  return { x: x + w / 2 - bw / 2, y: y + h / 2 - bh / 2, w: bw, h: bh };
}

/** Moves (x, y) so the turned table stays on the floor. */
export function keepOnFloor(x: number, y: number, w: number, h: number, rotation: number): { x: number; y: number } {
  const b = outline(x, y, w, h, rotation);
  const dx = b.x < 0 ? -b.x : b.x + b.w > GRID_W ? GRID_W - (b.x + b.w) : 0;
  const dy = b.y < 0 ? -b.y : b.y + b.h > GRID_H ? GRID_H - (b.y + b.h) : 0;
  return { x: round2(x + dx), y: round2(y + dy) };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

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

export const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;

/** A free spot for a new upright w×h table: scans row by row, leaving a cell of space. */
export function freeSpot(taken: Box[], w: number, h: number): { x: number; y: number } {
  for (let y = 1; y + h <= GRID_H; y++) {
    for (let x = 1; x + w <= GRID_W; x++) {
      const room = { x: x - 1, y: y - 1, w: w + 2, h: h + 2 };
      if (!taken.some((p) => overlaps(room, p))) return { x, y };
    }
  }
  return { x: 1, y: 1 };
}

function shapeOf(t: PlanTable): Shape {
  return t.shape && (SHAPES as readonly string[]).includes(t.shape) ? t.shape : "square";
}

/** Every table with a position, size and outline — saved ones as saved, the
 *  rest placed like the till's old layout (or in a free spot if that's taken). */
export function placeTables<T extends PlanTable>(tables: T[]): Placed<T>[] {
  const out: Placed<T>[] = [];
  const make = (t: T, x: number, y: number): Placed<T> => {
    const shape = shapeOf(t);
    const { w, h } = footprint(t.capacity, shape);
    const rotation = effectiveRotation(shape, t.rotation);
    return { ...t, x, y, w, h, shape, rotation, box: outline(x, y, w, h, rotation) };
  };
  const unsaved: T[] = [];
  for (const t of tables) {
    if (t.pos_x != null && t.pos_y != null) out.push(make(t, Number(t.pos_x), Number(t.pos_y)));
    else unsaved.push(t);
  }
  const allSorted = [...tables].sort((a, b) => tableNo(a) - tableNo(b));
  for (const t of unsaved.sort((a, b) => tableNo(a) - tableNo(b))) {
    const spot0 = legacySpot(allSorted.indexOf(t));
    let p = make(t, spot0.x, spot0.y);
    if (out.some((q) => overlaps(p.box, q.box))) {
      const spot = freeSpot(out.map((q) => q.box), p.w, p.h);
      p = make(t, spot.x, spot.y);
    }
    out.push(p);
  }
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
