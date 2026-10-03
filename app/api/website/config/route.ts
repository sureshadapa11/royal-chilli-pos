import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import type { SessionUser } from "@/lib/types";
import { areaAllows } from "@/lib/permissions";
import { bizDb } from "@/lib/business-db";
import { clearBusinessCache } from "@/lib/business";
import { applyWebsiteConfigUpdate, normaliseWebsiteConfig } from "@/lib/website-config";

// Staff Hub → Operations → Website. Every request works on the signed-in
// login's own business. Only the group owner may read another business's
// config (?businessId=X), and only the owner may switch online ordering on or
// off — the same rule as Settings → Business setup → Modules.
//
// Saves are optimistic-locked on businesses.website_config_version (migration
// 094): GET returns `version`, POST may send it back, and a save only writes
// if the row is still at the version it was based on — otherwise 409.

const COLUMNS = "id, name, tagline, logo_url, domain, custom_domain, modules, website_config, website_config_version";

type BusinessRow = {
  id: number; name: string; tagline: string | null; logo_url: string | null;
  domain: string | null; custom_domain: string | null;
  modules: Record<string, boolean> | null; website_config: unknown;
  website_config_version: number | null;
};

const versionOf = (b: BusinessRow) => Number(b.website_config_version ?? 1);

async function allowed(req: NextRequest): Promise<{ error: NextResponse } | { session: SessionUser }> {
  const session = await getSessionFromRequest(req);
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!areaAllows(session.role, "website", req.method)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { session };
}

async function load(businessId: number): Promise<BusinessRow | null> {
  const { data, error } = await supabase.from("businesses").select(COLUMNS).eq("id", businessId).maybeSingle();
  if (error || !data) return null;
  return data as unknown as BusinessRow;
}

function shape(b: BusinessRow, owner: boolean) {
  const m = b.modules ?? {};
  return {
    business: { id: b.id, name: b.name, tagline: b.tagline, logo_url: b.logo_url, domain: b.custom_domain || b.domain || null },
    config: normaliseWebsiteConfig(b.website_config),
    modules: {
      website: !!m.website, online_ordering: !!m.online_ordering, qr_ordering: !!m.qr_ordering,
      delivery: !!m.delivery, delivery_platforms: !!m.delivery_platforms, reservations: !!m.reservations,
    },
    canToggleOrdering: owner,
    version: versionOf(b),
  };
}

const conflict = (version?: number) => NextResponse.json(
  { error: "Someone else saved the website settings just now — reload and try again", ...(version ? { version } : {}) },
  { status: 409 },
);

export async function GET(req: NextRequest) {
  const auth = await allowed(req);
  if ("error" in auth) return auth.error;
  const { session } = auth;

  let businessId = session.businessId;
  const asked = req.nextUrl.searchParams.get("businessId");
  if (asked !== null) {
    const id = Number(asked);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Bad businessId" }, { status: 400 });
    if (id !== session.businessId && !session.owner) {
      return NextResponse.json({ error: "You can only see your own business's website" }, { status: 403 });
    }
    businessId = id;
  }

  const b = await load(businessId);
  if (!b) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  return NextResponse.json(shape(b, !!session.owner));
}

export async function POST(req: NextRequest) {
  const auth = await allowed(req);
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  // Saves always go to this login's business; naming another one is refused
  // rather than silently ignored.
  if (body.businessId !== undefined && Number(body.businessId) !== session.businessId) {
    return NextResponse.json({ error: "You can only edit your own business's website" }, { status: 403 });
  }
  const hasConfig = body.config !== undefined;
  const hasOrdering = body.online_ordering !== undefined;
  if (!hasConfig && !hasOrdering) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  if (hasOrdering && typeof body.online_ordering !== "boolean") {
    return NextResponse.json({ error: "online_ordering must be true or false" }, { status: 400 });
  }
  if (hasOrdering && !session.owner) {
    return NextResponse.json({ error: "Only the owner can switch online ordering on or off" }, { status: 403 });
  }
  const hasVersion = body.version !== undefined;
  if (hasVersion && (!Number.isInteger(body.version) || body.version < 1)) {
    return NextResponse.json({ error: "Bad version" }, { status: 400 });
  }

  const bid = session.businessId;
  const current = await load(bid);
  if (!current) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  const version = versionOf(current);
  if (hasVersion && body.version !== version) return conflict(version);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), website_config_version: version + 1 };
  let changedFields: string[] = [];
  if (hasConfig) {
    const { config, errors } = applyWebsiteConfigUpdate(normaliseWebsiteConfig(current.website_config), body.config);
    if (Object.keys(errors).length) return NextResponse.json({ error: "Please check the highlighted fields", fields: errors }, { status: 400 });
    patch.website_config = config;
    changedFields = Object.keys(body.config as Record<string, unknown>);
  }
  if (hasOrdering) patch.modules = { ...(current.modules ?? {}), online_ordering: body.online_ordering };

  // Only writes if nobody else has saved since `current` was read.
  const { data: updated, error } = await supabase.from("businesses").update(patch)
    .eq("id", bid).eq("website_config_version", version).select("id");
  if (error) return NextResponse.json({ error: "Couldn't save" }, { status: 500 });
  if (!updated || updated.length === 0) {
    const latest = await load(bid);
    return conflict(latest ? versionOf(latest) : undefined);
  }

  clearBusinessCache();
  const { error: auditError } = await bizDb(bid).from("audit_logs").insert({
    staff_id: session.id, action: "website_config_saved", entity_type: "business", entity_id: bid,
    changes: { fields: changedFields, ...(hasOrdering ? { online_ordering: body.online_ordering } : {}) },
  });
  if (auditError) {
    // Every change must be audited: put back what was there (unless someone
    // has saved on top since) and report the save as failed so it can be retried.
    const undo: Record<string, unknown> = { updated_at: new Date().toISOString(), website_config_version: version + 2 };
    if (hasConfig) undo.website_config = current.website_config ?? {};
    if (hasOrdering) undo.modules = current.modules ?? {};
    await supabase.from("businesses").update(undo).eq("id", bid).eq("website_config_version", version + 1);
    clearBusinessCache();
    return NextResponse.json({ error: "Couldn't record the change in the audit log — nothing was saved, please try again" }, { status: 500 });
  }

  const saved = await load(bid);
  return NextResponse.json({ success: true, ...(saved ? shape(saved, !!session.owner) : {}) });
}
