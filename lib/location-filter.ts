import { bizDb, BizDb } from "@/lib/business-db";
import { staffLocationIds } from "@/lib/locations";

/**
 * Filter clause for a staff member's location scope.
 * If staff has no location restrictions, returns null (no filter).
 * Otherwise returns { location_id: { in: [...assigned locations] } }.
 */
export async function staffLocationFilter(staffId: number): Promise<{ in: number[] } | null> {
  const locationIds = await staffLocationIds(staffId);
  if (locationIds.length === 0) return null; // No restriction: can see all locations
  return { in: locationIds };
}

/**
 * Apply location filter to an order query.
 * If staff has no restriction, query is unchanged.
 * Otherwise, adds .in("location_id", staffLocationIds).
 */
export async function applyLocationFilter<
  Q extends { in(column: string, values: readonly unknown[]): Q },
>(query: Q, staffId: number): Promise<Q> {
  const filter = await staffLocationFilter(staffId);
  if (!filter) return query;
  return query.in("location_id", filter.in);
}