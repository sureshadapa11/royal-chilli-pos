import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { bizDb } from "@/lib/business-db";
import { clearBusinessCache } from "@/lib/business";
import { SECRET_FIELDS, SECTIONS, validateSection, type Address } from "@/lib/business-setup";
import { encryptSecret, secretsConfigured } from "@/lib/secrets";

// Business setup (Staff Hub → Settings → Business setup) for the business this
// login is working for. Owner-only sections (tax, bank, modules, payments) can
// only be changed by the group owner; bank details and payment status are only
// ever sent to the owner. Payment keys are write-only: stored encrypted, and
// the page only learns whether each is connected.

const PUBLIC_COLUMNS = [
  "id", "slug", "name", "tagline", "legal_name", "company_number", "phone", "email", "website", "custom_domain", "logo_url", "brand_colour",
  "trading_address", "registered_address", "vat_registered", "vat_number", "vat_rate", "card_fee_rate", "vat_scheme", "utr",
  "paye_reference", "year_end", "accounts_email", "receipt_header", "receipt_footer", "order_prefix", "po_prefix",
  "modules", "privacy_policy", "terms", "refund_policy", "active",
].join(", ");

async function allowed(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return null;
  if (!session.owner && !areaAllows(session.role, "settings", req.method)) return null;
  return session;
}

export async function GET(req: NextRequest) {
  const session = await allowed(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: business, error } = await supabase.from("businesses").select(PUBLIC_COLUMNS).eq("id", session.businessId).single();
  if (error || !business) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  let privateDetails = null;
  if (session.owner) {
    const { data: p } = await supabase.from("business_private").select("*").eq("business_id", session.businessId).maybeSingle();
    privateDetails = {
      bank_name: p?.bank_name ?? null, account_name: p?.account_name ?? null, sort_code: p?.sort_code ?? null,
      account_number: p?.account_number ?? null, iban: p?.iban ?? null, swift_bic: p?.swift_bic ?? null,
      stripe_publishable_key: p?.stripe_publishable_key ?? null, sumup_merchant_code: p?.sumup_merchant_code ?? null,
      connected: {
        stripe_secret_key: !!p?.stripe_secret_key_enc,
        stripe_webhook_secret: !!p?.stripe_webhook_secret_enc,
        sumup_api_key: !!p?.sumup_api_key_enc,
      },
    };
  }

  return NextResponse.json({ business, private: privateDetails, owner: !!session.owner, secretsReady: secretsConfigured() });
}

const upper = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, "").toUpperCase() : v);
const clean = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v);

export async function PUT(req: NextRequest) {
  const session = await allowed(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const section = SECTIONS.find((s) => s.key === body?.section);
  const values = (body?.values ?? {}) as Record<string, unknown>;
  if (!section || typeof values !== "object") return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  if (section.ownerOnly && !session.owner) {
    return NextResponse.json({ error: "Only the owner can change this section" }, { status: 403 });
  }

  // A secret left blank means "keep the one already saved"; null means disconnect it.
  const toCheck = Object.fromEntries(Object.entries(values).filter(([k, v]) => !(SECRET_FIELDS.has(k) && (v === "" || v === null))));
  const errors = validateSection(section, toCheck);
  if (Object.keys(errors).length) return NextResponse.json({ error: "Please check the highlighted fields", fields: errors }, { status: 400 });

  const bid = session.businessId;

  if (section.key === "modules") {
    const { data: b } = await supabase.from("businesses").select("modules").eq("id", bid).single();
    const modules = { ...(b?.modules ?? {}) } as Record<string, boolean>;
    for (const [k, v] of Object.entries(values)) modules[k.replace(/^modules\./, "")] = v as boolean;
    const { error } = await supabase.from("businesses").update({ modules, updated_at: new Date().toISOString() }).eq("id", bid);
    if (error) return NextResponse.json({ error: "Couldn't save" }, { status: 500 });
  } else if (section.private) {
    const patch: Record<string, unknown> = { business_id: bid, updated_at: new Date().toISOString(), updated_by: session.id };
    for (const [k, v] of Object.entries(values)) {
      if (SECRET_FIELDS.has(k)) {
        if (v === "") continue;                           // keep what's saved
        if (v === null) { patch[`${k}_enc`] = null; continue; } // disconnect
        if (!secretsConfigured()) {
          return NextResponse.json({ error: "Payment keys can't be saved until the encryption key is added to the hosting settings (SETTINGS_ENCRYPTION_KEY)." }, { status: 503 });
        }
        patch[`${k}_enc`] = encryptSecret(String(v).trim());
      } else {
        patch[k] = k === "sort_code" ? String(v ?? "").replace(/[\s-]/g, "") || null
          : k === "iban" || k === "swift_bic" || k === "sumup_merchant_code" ? upper(v) || null
          : k === "account_number" ? String(v ?? "").replace(/\s/g, "") || null
          : clean(v);
      }
    }
    const { error } = await supabase.from("business_private").upsert(patch, { onConflict: "business_id" });
    if (error) return NextResponse.json({ error: "Couldn't save" }, { status: 500 });
  } else {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(values)) {
      if (k === "trading_address" || k === "registered_address") {
        const a = (v ?? {}) as Address;
        const tidy: Address = {};
        for (const part of ["line1", "line2", "city", "county", "postcode"] as const) {
          const s = String(a[part] ?? "").trim();
          if (s) tidy[part] = part === "postcode" ? s.toUpperCase() : s;
        }
        patch[k] = Object.keys(tidy).length ? tidy : null;
      } else if (k === "company_number" || k === "vat_number" || k === "utr" || k === "order_prefix" || k === "po_prefix" || k === "login_code") {
        patch[k] = upper(v) || null;
      } else if (k === "custom_domain") {
        patch[k] = typeof v === "string" ? (v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null) : null;
      } else if (k === "vat_rate" || k === "card_fee_rate") {
        patch[k] = Number(v);
      } else {
        patch[k] = clean(v);
      }
    }
    // Each business's order numbers must be told apart at a glance.
    if (typeof patch.order_prefix === "string" && patch.order_prefix) {
      const { data: clash } = await supabase.from("businesses").select("name").eq("order_prefix", patch.order_prefix).neq("id", bid).maybeSingle();
      if (clash) return NextResponse.json({ error: "Please check the highlighted fields", fields: { order_prefix: `${clash.name} already uses ${patch.order_prefix}` } }, { status: 400 });
    }
    if (typeof patch.po_prefix === "string" && patch.po_prefix) {
      const { data: clash } = await supabase.from("businesses").select("name").eq("po_prefix", patch.po_prefix).neq("id", bid).maybeSingle();
      if (clash) return NextResponse.json({ error: "Please check the highlighted fields", fields: { po_prefix: `${clash.name} already uses ${patch.po_prefix}` } }, { status: 400 });
    }
    if (typeof patch.login_code === "string" && patch.login_code) {
      const { data: clash } = await supabase.from("businesses").select("name").eq("login_code", patch.login_code).neq("id", bid).maybeSingle();
      if (clash) return NextResponse.json({ error: "Please check the highlighted fields", fields: { login_code: `${clash.name} already uses ${patch.login_code}` } }, { status: 400 });
    }
    if (typeof patch.custom_domain === "string" && patch.custom_domain) {
      const { data: clash } = await supabase.from("businesses").select("name").or(`custom_domain.eq.${patch.custom_domain},domain.eq.${patch.custom_domain}`).neq("id", bid).maybeSingle();
      if (clash) return NextResponse.json({ error: "Please check the highlighted fields", fields: { custom_domain: `${clash.name} already uses ${patch.custom_domain}` } }, { status: 400 });
    }
    const { error } = await supabase.from("businesses").update(patch).eq("id", bid);
    if (error) return NextResponse.json({ error: "Couldn't save" }, { status: 500 });
  }

  clearBusinessCache();
  // Audit: which fields changed — never the values of bank details or keys.
  await bizDb(bid).from("audit_logs").insert({
    staff_id: session.id, action: "business_setup_saved", entity_type: "business", entity_id: bid,
    changes: section.private ? { section: section.key, fields: Object.keys(values) } : { section: section.key, values },
  });
  return NextResponse.json({ success: true });
}
