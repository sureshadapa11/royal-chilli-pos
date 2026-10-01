import supabase from "@/lib/supabase";
import { DEFAULT_BUSINESS_ID } from "@/lib/business-id";

// Several independent businesses (The Royal Chilli, Melt House, …) run on
// this one system (migrations 076–079). Each staff login and each paired till carries the business
// it's working for; server code reads and writes that business's rows through
// lib/business-db.ts. Anything that doesn't say which business it is — an
// older login, a token from the attendance app — is The Royal Chilli.

export { DEFAULT_BUSINESS_ID };

export type BusinessModules = {
  till: boolean; kitchen_display: boolean; tables: boolean; qr_ordering: boolean;
  website: boolean; online_ordering: boolean; delivery: boolean; reservations: boolean;
  inventory: boolean; rewards: boolean; food_safety: boolean; delivery_platforms: boolean;
};

export type BusinessType = "restaurant" | "coffee_shop" | "pizza_shop" | "retail";

export type Business = {
  id: number;
  slug: string;
  name: string;
  business_type: BusinessType;
  created_at: string;
  updated_at: string;
  legal_name: string | null;
  company_number: string | null;
  vat_number: string | null;
  domain: string | null;
  custom_domain: string | null;
  logo_url: string | null;
  brand_colour: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website?: string | null;
  modules: BusinessModules;
  active: boolean;
  display_order: number;
  // Business setup (migrations 080, 082)
  tagline?: string | null;
  registered_address?: unknown;
  trading_address?: unknown;
  vat_registered?: boolean;
  vat_rate?: number;
  vat_scheme?: string | null;
  utr?: string | null;
  paye_reference?: string | null;
  year_end?: string | null;
  accounts_email?: string | null;
  receipt_header?: string | null;
  receipt_footer?: string | null;
  order_prefix?: string | null;
  po_prefix?: string | null;
  privacy_policy?: string | null;
  terms?: string | null;
  refund_policy?: string | null;
};

// The list changes rarely; keep it for a minute per server instance.
const TTL_MS = 60_000;
let cache: { at: number; list: Business[] } | null = null;

export async function listBusinesses(): Promise<Business[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.list;
  const { data, error } = await supabase.from("businesses").select("*").order("display_order").order("id");
  if (error) throw error;
  cache = { at: Date.now(), list: (data ?? []) as Business[] };
  return cache.list;
}

export function clearBusinessCache() {
  cache = null;
}

export async function getBusiness(id: number): Promise<Business | null> {
  return (await listBusinesses()).find((b) => b.id === id) ?? null;
}

const bareHost = (host: string) => host.toLowerCase().split(":")[0].replace(/^www\./, "");

/** The business whose website is on this domain (www. ignored), or null. */
export async function businessForHost(host: string | null | undefined): Promise<Business | null> {
  if (!host) return null;
  const h = bareHost(host);
  return (await listBusinesses()).find((b) => b.domain && bareHost(b.domain) === h) ?? null;
}

// Every business is independent (migration 079): each staff member belongs to
// exactly one business (staff.business_id). The group owner (staff.is_owner)
// belongs to none and can work inside any business.

/** A staff member's business, and whether they're the group owner. */
export async function staffHome(staffId: number): Promise<{ businessId: number | null; isOwner: boolean }> {
  const { data, error } = await supabase.from("staff").select("business_id, is_owner").eq("id", staffId).maybeSingle();
  if (error) throw error;
  return { businessId: (data?.business_id as number | null) ?? null, isOwner: !!data?.is_owner };
}

/** Businesses this staff member can work in: their own, or every business for the owner. */
export async function staffBusinessIds(staffId: number): Promise<number[]> {
  const home = await staffHome(staffId);
  if (home.isOwner) return (await listBusinesses()).map((b) => b.id);
  return home.businessId != null ? [home.businessId] : [];
}

/**
 * Which business a password login works for: their own business; for the
 * owner, the business whose website they're on (else The Royal Chilli).
 * null = not set up at any business.
 */
export async function loginBusinessId(staffId: number, host: string | null | undefined): Promise<number | null> {
  const home = await staffHome(staffId);
  if (home.isOwner) return (await businessForHost(host))?.id ?? DEFAULT_BUSINESS_ID;
  return home.businessId;
}

/**
 * The business a public web request is for — decided by the domain it came
 * in on, so each business's website shows its own menu. Unknown domains
 * (the vercel.app address, localhost) are The Royal Chilli.
 */
export async function websiteBusinessId(host: string | null | undefined, pick?: string | null): Promise<number> {
  // ?b=<slug> — for a business whose QR codes / links use a shared address
  // (no domain of its own yet). Only an active business can be picked.
  if (pick) {
    const b = (await listBusinesses()).find((x) => x.active && x.slug === pick.trim().toLowerCase());
    if (b) return b.id;
  }
  return (await businessForHost(host))?.id ?? DEFAULT_BUSINESS_ID;
}

/** websiteBusinessId for a server-rendered page. */
export async function pageBusinessId(): Promise<number> {
  const { headers } = await import("next/headers");
  return websiteBusinessId((await headers()).get("host"));
}

/**
 * For routes used by both the till and the website: a signed-in staff member
 * works for their login's business; anyone else gets the domain's business.
 */
export async function requestBusinessId(req: { headers: Headers; cookies: { get(name: string): { value: string } | undefined } }): Promise<number> {
  const { getSessionFromRequest } = await import("@/lib/auth");
  const session = await getSessionFromRequest(req as Parameters<typeof getSessionFromRequest>[0]);
  return session?.businessId ?? websiteBusinessId(req.headers.get("host"));
}

/** Ids of this business's own staff (the owner isn't on any business's staff list). */
export async function staffIdsAt(businessId: number): Promise<number[]> {
  const { data, error } = await supabase.from("staff").select("id").eq("business_id", businessId);
  if (error) throw error;
  return (data ?? []).map((r) => r.id as number);
}

/** Short prefix for this business's order numbers: RC-20260929-001, MH-…  */
export async function orderNumberPrefix(businessId: number): Promise<string> {
  const b = await getBusiness(businessId);
  // Settings → Business setup → Receipts & numbering.
  if (b?.order_prefix) return b.order_prefix;
  if (businessId === DEFAULT_BUSINESS_ID) return "RC";
  const parts = (b?.slug ?? `b${businessId}`).split("-").filter(Boolean);
  return (parts.length > 1 ? parts.map((p) => p[0]).join("") : parts[0].slice(0, 2)).toUpperCase();
}

/** The start of purchase-order numbers (Business setup; "PO" until set). */
export async function poNumberPrefix(businessId: number): Promise<string> {
  return (await getBusiness(businessId))?.po_prefix || "PO";
}
