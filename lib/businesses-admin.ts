import supabase from "@/lib/supabase";
import { DEFAULT_BUSINESS_ID, clearBusinessCache } from "@/lib/business";
import { checks } from "@/lib/business-setup";

// The group owner's Businesses screen (Staff Hub → Settings → Businesses):
// every business at a glance, add a new one, open / close it, and give it a
// starting rewards scheme copied from The Royal Chilli's.

export type BusinessSummary = {
  id: number; slug: string; name: string; active: boolean; order_prefix: string | null; domain: string | null;
  staff: number; customers: number; dishes: number; hasRewards: boolean;
};

async function countOf(table: string, businessId: number): Promise<number> {
  const { count } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("business_id", businessId);
  return count ?? 0;
}

export async function listBusinessSummaries(): Promise<BusinessSummary[]> {
  const { data, error } = await supabase.from("businesses").select("id, slug, name, active, order_prefix, domain").order("display_order").order("id");
  if (error) throw error;
  return Promise.all(
    (data ?? []).map(async (b) => {
      const [staff, customers, dishes, tiers, rewards] = await Promise.all([
        countOf("staff", b.id),
        countOf("customers", b.id),
        countOf("menu_items", b.id),
        countOf("loyalty_tiers", b.id),
        countOf("loyalty_rewards", b.id),
      ]);
      return { ...b, staff, customers, dishes, hasRewards: tiers + rewards > 0 } as BusinessSummary;
    }),
  );
}

export const slugify = (name: string) =>
  name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export const RESERVED_SLUGS = new Set([
  "api", "staff", "admin", "login", "auth", "public", "static", "favicon", "robots", "sitemap",
  "terms", "privacy", "privacy-policy", "checkout", "cart", "account", "menu", "book", "reservations",
  "orders", "receipts", "rewards", "loyalty", "settings", "pos"
]);

type Result<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

/** A new business: not open yet, every module on, Royal Chilli's rewards scheme to start from. */
export async function createBusiness(input: { name: string; orderPrefix: string }): Promise<Result<{ id: number; slug: string }>> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Enter the business's trading name", field: "name" };
  const prefix = input.orderPrefix.trim().toUpperCase();
  const prefixErr = checks.prefix(prefix);
  if (prefixErr) return { ok: false, error: prefixErr, field: "order_prefix" };
  const slug = slugify(name);
  if (!slug) return { ok: false, error: "Use letters or numbers in the name", field: "name" };
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, error: `"${slug}" is a reserved system name. Please choose a different name`, field: "name" };
  }

  const { data: all } = await supabase.from("businesses").select("name, slug, order_prefix");
  const samePrefix = (all ?? []).find((b) => b.order_prefix === prefix);
  if (samePrefix) return { ok: false, error: `${samePrefix.name} already uses ${prefix}`, field: "order_prefix" };
  const sameName = (all ?? []).find((b) => b.slug === slug || b.name.trim().toLowerCase() === name.toLowerCase());
  if (sameName) return { ok: false, error: `There's already a business called ${sameName.name}`, field: "name" };

  const { data: last } = await supabase.from("businesses").select("display_order").order("display_order", { ascending: false }).limit(1).maybeSingle();
  const { data: created, error } = await supabase.from("businesses")
    .insert({ name, slug, order_prefix: prefix, active: false, display_order: (last?.display_order ?? 0) + 1 })
    .select("id, slug").single();
  if (error || !created) return { ok: false, error: "Couldn't add the business" };

  await supabase.from("business_private").insert({ business_id: created.id });
  const copied = await copyRewardsScheme(DEFAULT_BUSINESS_ID, created.id);
  if (!copied.ok) console.error(`Rewards scheme not copied to business ${created.id}: ${copied.error}`);
  clearBusinessCache();
  return { ok: true, value: created };
}

/**
 * Copy one business's rewards scheme — tiers, rewards (incl. the welcome,
 * Bring a Friend and birthday rewards) and the points rules — to another that
 * has none yet. Customers, points and vouchers are never copied.
 */
export async function copyRewardsScheme(fromId: number, toId: number): Promise<Result<{ tiers: number; rewards: number; rules: number }>> {
  if (fromId === toId) return { ok: false, error: "That's the same business" };
  const [{ count: haveTiers }, { count: haveRewards }] = await Promise.all([
    supabase.from("loyalty_tiers").select("id", { count: "exact", head: true }).eq("business_id", toId),
    supabase.from("loyalty_rewards").select("id", { count: "exact", head: true }).eq("business_id", toId),
  ]);
  if ((haveTiers ?? 0) + (haveRewards ?? 0) > 0) return { ok: false, error: "This business already has a rewards scheme" };

  const { data: tiers } = await supabase.from("loyalty_tiers").select("id, name, min_lifetime_spend, points_multiplier, sort_order, active").eq("business_id", fromId).order("id");
  const tierMap = new Map<number, number>();
  for (const t of tiers ?? []) {
    const { id, ...rest } = t;
    const { data: nt, error } = await supabase.from("loyalty_tiers").insert({ ...rest, business_id: toId }).select("id").single();
    if (error || !nt) return { ok: false, error: "Couldn't copy the rewards tiers" };
    tierMap.set(id, nt.id);
  }

  const { data: rewards } = await supabase.from("loyalty_rewards")
    .select("name, description, points_cost, active, discount_amount, min_spend, eligible_tier_id, valid_days, per_customer_limit, start_date, end_date, is_birthday_reward, discount_pct, max_discount, order_types, is_welcome_reward, is_referral_reward")
    .eq("business_id", fromId).order("id");
  const rewardRows = (rewards ?? []).map((r) => ({
    ...r,
    eligible_tier_id: r.eligible_tier_id != null ? tierMap.get(r.eligible_tier_id) ?? null : null,
    business_id: toId,
  }));
  if (rewardRows.length) {
    const { error } = await supabase.from("loyalty_rewards").insert(rewardRows);
    if (error) return { ok: false, error: "Couldn't copy the rewards" };
  }

  // Points rules (loyalty_* settings) — only ones the new business hasn't set.
  const { data: rules } = await supabase.from("business_settings").select("key, value").eq("business_id", fromId).like("key", "loyalty\\_%");
  if (rules?.length) {
    await supabase.from("business_settings")
      .upsert(rules.map((r) => ({ business_id: toId, key: r.key, value: r.value })), { onConflict: "business_id,key", ignoreDuplicates: true });
  }
  return { ok: true, value: { tiers: tierMap.size, rewards: rewardRows.length, rules: rules?.length ?? 0 } };
}

/** Open a business (its website, QR links and ordering become reachable) or close it again. */
export async function setBusinessOpen(id: number, active: boolean): Promise<Result<null>> {
  if (id === DEFAULT_BUSINESS_ID && !active) return { ok: false, error: "The Royal Chilli can't be closed from here" };

  if (active) {
    const { data: b, error: fetchErr } = await supabase
      .from("businesses")
      .select("id, name, order_prefix, trading_address")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !b) return { ok: false, error: "Business not found" };

    const missing: string[] = [];
    if (!b.name || !b.name.trim()) missing.push("trading name");
    if (!b.order_prefix || checks.prefix(b.order_prefix)) missing.push("valid order prefix");

    const addr = (b.trading_address ?? {}) as { line1?: string; postcode?: string };
    const line1 = String(addr.line1 ?? "").trim();
    const postcode = String(addr.postcode ?? "").trim();
    if (!line1 || !postcode || checks.postcode(postcode)) {
      missing.push("trading address with valid UK postcode");
    }

    if (missing.length > 0) {
      return {
        ok: false,
        error: `Cannot open business until setup prerequisites are complete: missing ${missing.join(", ")}`,
      };
    }
  }

  const { error } = await supabase.from("businesses").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: "Couldn't update the business" };
  clearBusinessCache();
  return { ok: true, value: null };
}
