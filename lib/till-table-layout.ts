// The till's table panel, laid out like the original till (agreed 2026-10-18):
// by table number only, every table the same card. The first 9 make a 3 × 3
// block numbered up each column (T3 T6 T9 / T2 T5 T8 / T1 T4 T7, matching the
// restaurant), the rest go in rows of 4 beneath it. The Staff Hub floor plan
// (lib/floor-plan.ts) is unchanged; the till just doesn't draw it any more.
// Safe in the browser.

type Numbered = { table_number: string };

export const tableNumber = (t: Numbered) => parseInt(t.table_number.replace(/\D/g, ""), 10) || 0;

/** Lay `items` out column by column, bottom to top, for a CSS grid that fills row by row. */
export function columnMajor<T>(items: T[], cols: number): T[] {
  const rows = Math.ceil(items.length / cols);
  const columns = Array.from({ length: cols }, (_, c) => items.slice(c * rows, c * rows + rows).reverse());
  const flat: T[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (columns[c][r] !== undefined) flat.push(columns[c][r]);
    }
  }
  return flat;
}

export function classicTillLayout<T extends Numbered>(tables: T[]): { block: T[]; rest: T[] } {
  const sorted = [...tables].sort((a, b) => tableNumber(a) - tableNumber(b));
  return { block: columnMajor(sorted.slice(0, 9), 3), rest: sorted.slice(9) };
}
