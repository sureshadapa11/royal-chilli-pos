import { classicTillLayout } from "../till-table-layout";

const tables = (...nums: number[]) => nums.map((n) => ({ table_number: `T${n}` }));
const names = (ts: { table_number: string }[]) => ts.map((t) => t.table_number);

describe("till tables laid out like the original till", () => {
  it("Royal Chilli's 10 tables: 3 × 3 block up each column, T10 underneath", () => {
    const { block, rest } = classicTillLayout(tables(10, 1, 2, 3, 4, 5, 6, 7, 8, 9));
    expect(names(block)).toEqual(["T3", "T6", "T9", "T2", "T5", "T8", "T1", "T4", "T7"]);
    expect(names(rest)).toEqual(["T10"]);
  });
  it("13 tables: T10–T13 in the row of 4", () => {
    const { rest } = classicTillLayout(tables(13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1));
    expect(names(rest)).toEqual(["T10", "T11", "T12", "T13"]);
  });
  it("sorts by number, not text (T2 before T10)", () => {
    const { block } = classicTillLayout(tables(10, 2, 1));
    expect(names(block)).toEqual(["T1", "T2", "T10"]);
  });
  it("no tables, nothing to draw", () => {
    expect(classicTillLayout([])).toEqual({ block: [], rest: [] });
  });
});
