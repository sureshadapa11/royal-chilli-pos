import { footprint, freeSpot, keepOnFloor, outline, overlaps, placeTables, usedBox, GRID_H, GRID_W } from "../floor-plan";

const t = (n: number, capacity = 4, extra: object = {}) => ({ id: n, table_number: `T${n}`, capacity, ...extra });

describe("floor plan", () => {
  it("lays unsaved tables out like the till's old grid: T3 T6 T9 / T2 T5 T8 / T1 T4 T7, then a row", () => {
    const placed = placeTables(Array.from({ length: 13 }, (_, i) => t(i + 1)));
    const at = (n: number) => { const p = placed.find((x) => x.id === n)!; return [p.x, p.y]; };
    expect(at(3)).toEqual([1, 1]);
    expect(at(9)).toEqual([17, 1]);
    expect(at(1)).toEqual([1, 17]);
    expect(at(7)).toEqual([17, 17]);
    expect(at(10)).toEqual([1, 25]);
    expect(at(13)).toEqual([25, 25]);
  });

  it("keeps saved spots and sizes tables by seats and shape", () => {
    const [p] = placeTables([t(1, 8, { pos_x: 5, pos_y: 6, shape: "rect" })]);
    expect(p).toMatchObject({ x: 5, y: 6, shape: "rect", w: 9, h: 6 });
    expect(footprint(2, "round")).toEqual({ w: 4, h: 4 });
    expect(footprint(4, "square").w).toBeLessThan(footprint(8, "square").w);
  });

  it("finds a free spot that doesn't touch other tables, inside the grid", () => {
    const placed = placeTables([t(1, 4, { pos_x: 1, pos_y: 1 })]);
    const s = freeSpot(placed.map((p) => p.box), 5, 5);
    expect(overlaps({ ...s, w: 5, h: 5 }, { x: placed[0].x - 1, y: placed[0].y - 1, w: placed[0].w + 2, h: placed[0].h + 2 })).toBe(false);
    expect(s.x + 5).toBeLessThanOrEqual(GRID_W);
    expect(s.y + 5).toBeLessThanOrEqual(GRID_H);
  });

  it("an unsaved table never lands on a saved one", () => {
    const placed = placeTables([t(1, 4, { pos_x: 1, pos_y: 17 }), t(2, 4)]); // T2's old spot is (1, 9) — free
    expect(placed.find((p) => p.id === 2)).toMatchObject({ x: 1, y: 9 });
    const clash = placeTables([t(5, 4, { pos_x: 1, pos_y: 9 }), t(2, 4)]); // T2's old spot is taken
    const a = clash.find((p) => p.id === 2)!, b = clash.find((p) => p.id === 5)!;
    expect(overlaps(a.box, b.box)).toBe(false);
  });

  it("crops the till's view to the tables in use", () => {
    expect(usedBox(placeTables([t(1, 4, { pos_x: 10, pos_y: 4 }), t(2, 2, { pos_x: 20, pos_y: 12 })]))).toEqual({ x: 10, y: 4, w: 14, h: 12 });
  });

  it("keeps fractional spots and turns tables about their centre", () => {
    const [p] = placeTables([t(1, 8, { pos_x: "4.25", pos_y: 6.5, shape: "rect", rotation: 90 })]);
    expect(p).toMatchObject({ x: 4.25, y: 6.5, w: 9, h: 6, rotation: 90 });
    // turned 90°: the outline is 6 wide and 9 deep, same centre
    expect(p.box.w).toBeCloseTo(6);
    expect(p.box.h).toBeCloseTo(9);
    expect(p.box.x + p.box.w / 2).toBeCloseTo(4.25 + 4.5);
    // round tables ignore the turn
    expect(placeTables([t(2, 4, { pos_x: 1, pos_y: 1, shape: "round", rotation: 45 })])[0].rotation).toBe(0);
  });

  it("a 45° table takes more room, and is kept on the floor", () => {
    const b = outline(0, 0, 5, 5, 45);
    expect(b.w).toBeCloseTo(5 * Math.SQRT2);
    const { x, y } = keepOnFloor(0, 0, 5, 5, 45);
    const kept = outline(x, y, 5, 5, 45);
    expect(kept.x).toBeGreaterThanOrEqual(-0.01);
    expect(kept.y).toBeGreaterThanOrEqual(-0.01);
    const far = keepOnFloor(GRID_W, GRID_H, 5, 5, 0);
    expect(far.x + 5).toBeLessThanOrEqual(GRID_W);
    expect(far.y + 5).toBeLessThanOrEqual(GRID_H);
  });
});
