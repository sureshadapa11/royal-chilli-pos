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

/** Location ids a staff member is limited to. Empty = can work at every location. */
export async function staffLocationIds(staffId: number): Promise<number[]> {
  const { data, error } = await supabase
    .from("staff_locations")
    .select("location_id")
    .eq("staff_id", staffId);
  if (error) throw error;
  return (data ?? []).map((r) => r.location_id).filter((id): id is number => id !== null);
}

export async function canAccessLocation(staffId: number, locationId: number): Promise<boolean> {
  const assigned = await staffLocationIds(staffId);
  return assigned.length === 0 || assigned.includes(locationId);
}
