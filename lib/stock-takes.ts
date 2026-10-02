import { bizDb } from "@/lib/business-db";
import { canAccessLocation } from "@/lib/locations";
import type { SessionUser } from "@/lib/types";

export const STOCK_TAKE_REASON_CODES = ["waste", "spoilage", "over_portion", "unknown", "count_error"] as const;

export type StockTakeRow = Record<string, unknown> & { id: number; status: string; location_id: number };

/**
 * A stock take by id, for the caller: it must be this business's (404) and at
 * a location the caller is assigned to (403) — knowing another location's
 * take id isn't enough to read or change it. The group owner can use any
 * location of the business.
 */
export async function stockTakeForCaller(
  session: SessionUser,
  stockTakeId: string,
): Promise<{ stockTake: StockTakeRow } | { error: string; status: number }> {
  if (!/^\d+$/.test(stockTakeId)) return { error: "Stock take not found", status: 404 };
  const { data, error } = await bizDb(session.businessId)
    .from("stock_takes")
    .select("*")
    .eq("id", Number(stockTakeId))
    .maybeSingle();
  if (error) throw error;
  if (!data) return { error: "Stock take not found", status: 404 };
  const stockTake = data as StockTakeRow;
  if (!session.owner && !(await canAccessLocation(session.id, Number(stockTake.location_id)))) {
    return { error: "You cannot access this location", status: 403 };
  }
  return { stockTake };
}
