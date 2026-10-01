import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";

export interface Location {
  id: number;
  business_id: number;
  name: string;
  address?: { line1?: string; city?: string; county?: string; postcode?: string } | null;
  phone?: string | null;
  email?: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export async function listLocations(businessId: number): Promise<Location[]> {
  const { data, error } = await bizDb(businessId)
    .from("locations")
    .select("*")
    .eq("active", 1)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Location[];
}

export async function getLocation(businessId: number, locationId: number): Promise<Location | null> {
  const { data, error } = await bizDb(businessId)
    .from("locations")
    .select("*")
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw error;
  return (data as Location | null) ?? null;
}

export async function createLocation(
  businessId: number,
  values: Partial<Location> & { name: string },
): Promise<Location> {
  const { data, error } = await bizDb(businessId)
    .from("locations")
    .insert({
      name: values.name,
      address: values.address ?? null,
      phone: values.phone ?? null,
      email: values.email ?? null,
      active: 1,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Location;
}

export async function updateLocation(
  businessId: number,
  locationId: number,
  values: Partial<Location>,
): Promise<Location> {
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined && !["id", "business_id", "created_at", "updated_at"].includes(k)) payload[k] = v;
  }
  payload.updated_at = new Date().toISOString();
  const { data, error } = await bizDb(businessId)
    .from("locations")
    .update(payload)
    .eq("id", locationId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Location;
}

/**
 * Location ids a staff member is assigned to. Empty = unassigned: they have no
 * location access for inventory or location analytics (explicit assignment is
 * required; only the group owner is exempt).
 */
export async function staffLocationIds(staffId: number): Promise<number[]> {
  const { data, error } = await supabase
    .from("staff_locations")
    .select("location_id")
    .eq("staff_id", staffId);
  if (error) throw error;
  return (data ?? []).map((r) => r.location_id).filter((id): id is number => id !== null);
}

/** Each staff member's assigned location ids (empty = unassigned). */
export async function locationIdsByStaff(staffIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>(staffIds.map((id) => [id, []]));
  if (staffIds.length === 0) return map;
  const { data, error } = await supabase
    .from("staff_locations")
    .select("staff_id, location_id")
    .in("staff_id", staffIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (row.location_id == null) continue;
    map.get(row.staff_id)?.push(row.location_id);
  }
  for (const ids of map.values()) ids.sort((a, b) => a - b);
  return map;
}

/** The business's primary location: its first active one (the group owner's default inventory location). */
export async function primaryLocationId(businessId: number): Promise<number> {
  const { data, error } = await bizDb(businessId)
    .from("locations")
    .select("id")
    .eq("active", 1)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: number } | null)?.id ?? 1;
}

/**
 * The inventory location a request works on: the requested one, else the
 * caller's first assigned location. Staff must be assigned to the location —
 * unassigned staff are rejected (400 with no location_id, 403 with one). The
 * group owner (`owner`) can use any location of the business and defaults to
 * its primary location.
 */
export async function resolveInventoryLocation(
  businessId: number,
  staffId: number,
  requestedLocationId: string | null,
  owner = false,
): Promise<{ locationId: number } | { error: string; status: number }> {
  const { data: assignments, error: assignmentError } = await supabase
    .from("staff_locations")
    .select("location_id")
    .eq("staff_id", staffId)
    .order("assigned_at", { ascending: true })
    .order("location_id", { ascending: true });
  if (assignmentError) throw assignmentError;
  const assigned = (assignments ?? []).map((row) => row.location_id).filter((id): id is number => id !== null);
  const requested = requestedLocationId != null && requestedLocationId !== "";
  if (!requested && !owner && assigned.length === 0) {
    return { error: "You aren't assigned to any location", status: 400 };
  }
  const locationId = requested
    ? Number(requestedLocationId)
    : assigned[0] ?? await primaryLocationId(businessId);

  if (!Number.isInteger(locationId) || locationId < 1) {
    return { error: "Invalid location_id", status: 400 };
  }
  if (requested && !owner && !assigned.includes(locationId)) {
    return { error: "You cannot access this location", status: 403 };
  }

  const { data, error } = await bizDb(businessId)
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { error: "Location not found", status: 404 };
  return { locationId };
}

/** Whether a staff member is assigned to a location (unassigned staff can access none). */
export async function canAccessLocation(staffId: number, locationId: number): Promise<boolean> {
  const assigned = await staffLocationIds(staffId);
  return assigned.includes(locationId);
}
