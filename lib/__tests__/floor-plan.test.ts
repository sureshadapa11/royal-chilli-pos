import { COLS, ROWS, TABLE_SIZE, freeSlot, nearestSlot, placeTables, slotXY, usedBox } from "../floor-plan";

const t = (n: number, capacity = 4, extra: object = {}) => ({ id: n, table_number: `T${n}`, capacity, ...extra });
const at = (placed: { id: number; col: number; row: number }[], n: number) => {
  const p = placed.find((x) => x.id === n)!;
  return [p.col, p.row];
};

describe("floor plan", () => {
  it("lays unsaved tables out like the till's old grid: T3 T6 T9 / T2 T5 T8 / T1 T4 T7, then a row of 4", () => {
    const placed = placeTables(Array.from({ length: 13 }, (_, i) => t(i + 1)));
    expect(at(placed, 3)).toEqual([0, 0]);
    expect(at(placed, 9)).toEqual([2, 0]);
    expect(at(placed, 1)).toEqual([0, 2]);
    expect(at(placed, 7)).toEqual([2, 2]);
    expect(at(placed, 10)).toEqual([0, 3]);
    expect(at(placed, 13)).toEqual([3, 3]);
  });

  it("every table is the same size, whatever its seats or shape", () => {
    const placed = placeTables([t(1, 2), t(2, 8, { shape: "rect", rotation: 90 }), t(3, 6, { shape: "round" })]);
    for (const p of placed) expect([p.w, p.h]).toEqual([TABLE_SIZE, TABLE_SIZE]);
  });

  it("tables in a row share a top edge and tables in a column share a left edge", () => {
    const placed = placeTables(Array.from({ length: 13 }, (_, i) => t(i + 1)));
    const byRow = new Map<number, Set<number>>(), byCol = new Map<number, Set<number>>();
    for (const p of placed) {
      byRow.set(p.row, (byRow.get(p.row) ?? new Set()).add(p.y));
      byCol.set(p.col, (byCol.get(p.col) ?? new Set()).add(p.x));
    }
    for (const ys of byRow.values()) expect(ys.size).toBe(1);
    for (const xs of byCol.values()) expect(xs.size).toBe(1);
  });

  it("a saved spot snaps to the nearest slot, even if it was dragged slightly off", () => {
    const [p] = placeTables([t(6, 4, { pos_x: "11.04", pos_y: 0.32 })]);
    expect([p.col, p.row]).toEqual([1, 0]);
    expect([p.x, p.y]).toEqual([slotXY(1, 0).x, slotXY(1, 0).y]);
    expect(nearestSlot(-5, 999)).toEqual({ col: 0, row: ROWS - 1 });
  });

  it("two tables never share a slot", () => {
    const placed = placeTables([t(1, 4, { pos_x: 9, pos_y: 9 }), t(2, 4, { pos_x: 9.5, pos_y: 9 }), t(3, 4)]);
    const slots = placed.map((p) => `${p.col},${p.row}`);
    expect(new Set(slots).size).toBe(3);
    expect(at(placed, 1)).toEqual([1, 1]); // the lower number keeps it
  });

  it("finds the first free slot, row by row, and says when the floor is full", () => {
    expect(freeSlot(new Set(["0,0", "1,0"]))).toEqual({ col: 2, row: 0 });
    const all = new Set<string>();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) all.add(`${c},${r}`);
    expect(freeSlot(all).row).toBe(ROWS);
  });

  it("crops the till's view to the tables in use", () => {
    const placed = placeTables([t(1, 4, { pos_x: slotXY(1, 0).x, pos_y: slotXY(1, 0).y }), t(2, 2, { pos_x: slotXY(2, 1).x, pos_y: slotXY(2, 1).y })]);
    expect(usedBox(placed)).toEqual({ x: slotXY(1, 0).x, y: slotXY(1, 0).y, w: 8 + TABLE_SIZE, h: 8 + TABLE_SIZE });
  });
});
