import { listBusinesses } from "@/lib/business";
import { r2 } from "@/lib/finance";
import { rangeDates, type RangeKey } from "@/lib/admin-dashboard";
import { tradingDayStr } from "@/lib/london-date";
import { accountsByDay, totalFigures } from "@/lib/daily-figures";

// The group owner's view across every business, side by side, plus the total.
// Same sums as each business's Daily accounts month sheet (lib/daily-figures.ts):
// Total sales = Z report + delivery platforms + catering paid; Ex-VAT = ÷ 1.2;
// All costs = every bit of money out; Profit = Ex-VAT − All costs.

export type GroupRow = {
  id: number;
  name: string;
  active: boolean;
  totalSales: number;
  exVat: number;
  staff: number;   // staff wages (part of costs)
  costs: number;   // all money out
  profit: number;
};

export type GroupOverview = { range: RangeKey; from: string; to: string; rows: GroupRow[]; total: Omit<GroupRow, "id" | "name" | "active"> };

export async function getGroupOverview(range: RangeKey): Promise<GroupOverview> {
  const { from, to } = rangeDates(range, tradingDayStr());
  const businesses = await listBusinesses();
  const rows = await Promise.all(
    businesses.map(async (b): Promise<GroupRow> => {
      const t = totalFigures((await accountsByDay(b.id, from, to)).days);
      return {
        id: b.id, name: b.name, active: b.active,
        totalSales: t.total_sales, exVat: t.ex_vat, staff: t.out.wages, costs: t.money_out, profit: t.net_total,
      };
    }),
  );
  const sum = (k: keyof Omit<GroupRow, "id" | "name" | "active">) => r2(rows.reduce((s, r) => s + r[k], 0));
  return {
    range, from, to, rows,
    total: { totalSales: sum("totalSales"), exVat: sum("exVat"), staff: sum("staff"), costs: sum("costs"), profit: sum("profit") },
  };
}
