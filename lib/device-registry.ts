import supabase from "@/lib/supabase";

export type PosDevicePairingStatus = "unpaired" | "pending" | "paired";
export type PosDeviceStatus = "pending" | "paired" | "active" | "offline" | "disabled" | "maintenance";

export type PosDevice = {
  id: number;
  business_id: number;
  location_id?: number | null;
  device_name: string;
  serial_number?: string | null;
  device_fingerprint?: string | null;
  registration_code_hash?: string | null;
  pairing_status: PosDevicePairingStatus;
  status: PosDeviceStatus;
  app_version?: string | null;
  last_seen_at?: string | null;
  paired_at?: string | null;
  disabled_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export async function listPosDevices(businessId: number): Promise<PosDevice[]> {
  const { data, error } = await supabase
    .from("pos_devices")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as PosDevice[];
}

export async function getPosDevice(businessId: number, deviceId: number): Promise<PosDevice | null> {
  const { data, error } = await supabase
    .from("pos_devices")
    .select("*")
    .eq("business_id", businessId)
    .eq("id", deviceId)
    .maybeSingle();

  if (error) throw error;
  return (data as PosDevice | null) ?? null;
}

export async function createPosDevice(
  businessId: number,
  values: Partial<PosDevice> & { device_name: string }
): Promise<PosDevice> {
  const payload = {
    business_id: businessId,
    location_id: values.location_id ?? null,
    device_name: values.device_name,
    serial_number: values.serial_number ?? null,
    device_fingerprint: values.device_fingerprint ?? null,
    registration_code_hash: values.registration_code_hash ?? null,
    pairing_status: values.pairing_status ?? "unpaired",
    status: values.status ?? "pending",
    app_version: values.app_version ?? null,
    last_seen_at: values.last_seen_at ?? null,
    paired_at: values.paired_at ?? null,
    disabled_at: values.disabled_at ?? null,
  };

  const { data, error } = await supabase
    .from("pos_devices")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data as PosDevice;
}

export async function updatePosDevice(
  businessId: number,
  deviceId: number,
  values: Partial<PosDevice>
): Promise<PosDevice> {
  const payload: Record<string, unknown> = { ...values };
  delete payload.id;
  delete payload.business_id;
  delete payload.created_at;
  delete payload.updated_at;

  const { data, error } = await supabase
    .from("pos_devices")
    .update(payload)
    .eq("business_id", businessId)
    .eq("id", deviceId)
    .select("*")
    .single();

  if (error) throw error;
  return data as PosDevice;
}

export async function markPosDeviceSeen(
  businessId: number,
  deviceId: number,
  appVersion?: string | null
): Promise<PosDevice> {
  return updatePosDevice(businessId, deviceId, {
    last_seen_at: new Date().toISOString(),
    app_version: appVersion ?? null,
    status: "active",
  });
}
