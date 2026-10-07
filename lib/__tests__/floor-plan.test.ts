import { COLS, ROWS, TABLE_SIZE, freeSlot, groupsOf, joinLabel, nearestSlot, placeTables, planJoin, slotXY, rowsShown, usedBox } from "../floor-plan";

const t = (n: number, capacity = 4, extra: object = {}) => ({ id: n, table_number: `T${n}`, capacity, ...extra });
const at = (placed: { id: number; col: number; row: number }[], n: number) => {
  const p = placed.find((x) => x.id === n)!;
  return [p.col, p.row];
};

describe("floor plan", () => {
  it("lays unsaved tables out like the till's old grid on one even grid: T3 T6 T9 / T2 T5 T8 / T1 T4 T7, then a row", () => {
    const placed = placeTables(Array.from({ length: 13 }, (_, i) => t(i + 1)));
    expect(at(placed, 3)).toEqual([0, 0]);
    expect(at(placed, 9)).toEqual([2, 0]);
    expect(at(placed, 1)).toEqual([0, 2]);
    expect(at(placed, 7)).toEqual([2, 2]);
    expect(at(placed, 10)).toEqual([0, 3]);
    expect(at(placed, 13)).toEqual([3, 3]);
    // every gap between neighbours is the same
    const xs = [...new Set(placed.map((p) => p.x))].sort((a, b) => a - b);
    expect(new Set(xs.slice(1).map((x, i) => x - xs[i])).size).toBe(1);
  });

  it("snaps to whole slots only, and two tables never share one", () => {
    expect(nearestSlot(slotXY(1, 0).x + 3, slotXY(0, 2).y)).toEqual({ col: 1, row: 2 });
    expect(nearestSlot(slotXY(1, 0).x + 5, 1)).toEqual({ col: 2, row: 0 });
    const placed = placeTables([t(1, 4, { pos_x: slotXY(1, 0).x, pos_y: 1 }), t(2, 4, { pos_x: slotXY(1, 0).x + 2, pos_y: 1 })]);
    expect(at(placed, 1)).toEqual([1, 0]);
    expect(at(placed, 2)).not.toEqual([1, 0]); // would share T1's slot, so it goes to a free one
  });

  it("shows the rows in use plus one spare", () => {
    expect(rowsShown(placeTables(Array.from({ length: 13 }, (_, i) => t(i + 1))))).toBe(5);
    expect(rowsShown(placeTables([t(1, 4, { pos_x: 1, pos_y: 1 })]))).toBe(2);
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
    const [p] = placeTables([t(6, 4, { pos_x: "9.3", pos_y: 0.32 })]);
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
    expect(freeSlot([{ col: 0, row: 0 }, { col: 1, row: 0 }])).toEqual({ col: 2, row: 0 });
    expect(freeSlot([{ col: 0.5, row: 0 }])).toEqual({ col: 2, row: 0 }); // 0 and 1 both overlap it
    const all: { col: number; row: number }[] = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) all.push({ col: c, row: r });
    expect(freeSlot(all).row).toBe(ROWS);
  });

  it("crops the till's view to the tables in use", () => {
    const placed = placeTables([t(1, 4, { pos_x: slotXY(1, 0).x, pos_y: slotXY(1, 0).y }), t(2, 2, { pos_x: slotXY(2, 1).x, pos_y: slotXY(2, 1).y })]);
    expect(usedBox(placed)).toEqual({ x: slotXY(1, 0).x, y: slotXY(1, 0).y, w: 8 + TABLE_SIZE, h: 8 + TABLE_SIZE });
  });

  describe("joined tables", () => {
    const at2 = (col: number, row: number) => ({ pos_x: slotXY(col, row).x, pos_y: slotXY(col, row).y });
    const thirteen = () => placeTables(Array.from({ length: 13 }, (_, i) => t(i + 1)));

    it("labels a group by table number, with the group name", () => {
      expect(joinLabel([t(2), t(1)])).toBe("T1 + T2");
      expect(joinLabel([t(10), t(9), t(1)], " 🎂 Birthday party ")).toBe("T1 + T9 + T10 · 🎂 Birthday party");
    });

    it("draws a group as one box over its slots, lead first", () => {
      const placed = placeTables([t(1, 4, at2(0, 0)), t(2, 4, { ...at2(1, 0), joined_to: 1 }), t(3, 4, at2(3, 0))]);
      const groups = groupsOf(placed);
      expect(groups).toHaveLength(2);
      const g = groups.find((x) => x.lead.id === 1)!;
      expect(g.members.map((m) => m.id)).toEqual([1, 2]);
      expect(g.box).toEqual({ x: slotXY(0, 0).x, y: slotXY(0, 0).y, w: 8 + TABLE_SIZE, h: TABLE_SIZE });
    });

    it("a lone table joins on the right, swapping out whatever is there", () => {
      // T3 at (0,0), T6 at (1.5,0): joining T1 (0,2) onto T3 swaps it with T6
      const plan = planJoin(thirteen(), 3, 1);
      expect(plan).toEqual({ moves: [{ id: 1, ...slotXY(1, 0) }, { id: 6, ...slotXY(0, 2) }] });
    });

    it("nothing moves when the table is already beside it", () => {
      expect(planJoin(thirteen(), 10, 11)).toEqual({ moves: [] }); // T11 is right of T10
      expect(planJoin(thirteen(), 3, 2)).toEqual({ moves: [] }); // T2 is below T3
      expect(planJoin(thirteen(), 3, 6)).toEqual({ moves: [] }); // T6 is right of T3
    });

    it("a group grows along its line, and only swaps out lone tables", () => {
      // T10 + T11 along the bottom row: the next spot along is T12's (2,3), then left is off the floor
      const placed = placeTables(thirteen().map((p) => (p.id === 11 ? { ...p, joined_to: 10 } : p)));
      expect(planJoin(placed, 10, 1)).toEqual({ moves: [{ id: 1, ...slotXY(2, 3) }, { id: 12, ...slotXY(0, 2) }] });
      // T12 joined to T13: T10 + T11 can't push it aside
      const blocked = placeTables(placed.map((p) => (p.id === 13 ? { ...p, joined_to: 12 } : p)));
      expect(planJoin(blocked, 10, 1)).toEqual({ error: expect.stringMatching(/no room/) });
    });

    it("won't join a table that's in another group, or twice", () => {
      const placed = placeTables(thirteen().map((p) => (p.id === 6 ? { ...p, joined_to: 3 } : p)));
      expect(planJoin(placed, 1, 6)).toEqual({ error: expect.stringMatching(/unjoin it first/) });
      expect(planJoin(placed, 3, 6)).toEqual({ error: expect.stringMatching(/already joined/) });
    });

    it("a group in a column grows downwards", () => {
      const placed = placeTables([t(1, 4, at2(0, 0)), t(2, 4, { ...at2(0, 1), joined_to: 1 }), t(3, 4, at2(4, 4))]);
      expect(planJoin(placed, 1, 3)).toEqual({ moves: [{ id: 3, ...slotXY(0, 2) }] });
    });
  });
});
