import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { orderTypesLabel, redemptionProblem, rewardAllowsOrderType, rewardDiscount, type RewardTerms } from "@/lib/loyalty";

// Staff Hub → Customers → Redemptions → "Check & use a code": for codes shown
// while the till isn't being used. Same checks as the till's code box.
// POST { code, bill?, order_type?, confirm? }
//   confirm false → what the code is, whether it can be used, and the £ to
//                   give off `bill` (nothing changes)
//   confirm true  → also marks it used (no till bill), so it can't be used again.
// Any staff member can use a code, as on the till.

const ORDER_TYPES = ["dine_in", "takeaway", "delivery"];

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const code = String(body?.code ?? "").replace(/\s+/g, "").toUpperCase();
  if (!code) return NextResponse.json({ message: "Type the code first" }, { status: 400 });
  const bill = body?.bill === "" || body?.bill == null ? null : Number(body.bill);
  if (bill != null && (!Number.isFinite(bill) || bill < 0 || bill > 100_000)) return NextResponse.json({ message: "The bill amount doesn't look right" }, { status: 400 });
  const orderType = ORDER_TYPES.includes(body?.order_type) ? String(body.order_type) : null;

  const db = bizDb(session.businessId);
  const { data: r } = await db.from("loyalty_redemptions")
    .select("id, code, status, valid_from, expires_at, redeemed_at, reward:loyalty_rewards(name, description, discount_amount, discount_pct, max_discount, order_types, min_spend), customer:customers(name, phone)")
    .eq("code", code).maybeSingle();
  if (!r) return NextResponse.json({ error: "INVALID_CODE", message: "No reward found with that code" }, { status: 404 });

  const reward = r.reward as unknown as RewardTerms & { name: string; description: string | null; min_spend: number | null };
  const terms = {
    name: reward.name, description: reward.description,
    orderTypes: reward.order_types?.length ? orderTypesLabel(reward.order_types) : null,
    minSpend: reward.min_spend ? Number(reward.min_spend) : null,
    expiresAt: r.expires_at,
  };
  const customer = r.customer as unknown as { name: string; phone: string | null } | null;
  const base = { code: r.code, customer, terms };

  const problem = redemptionProblem(r)
    ?? (orderType && !rewardAllowsOrderType(reward, orderType) ? { error: "WRONG_ORDER_TYPE", message: `This voucher is for ${terms.orderTypes} orders only` } : null)
    ?? (bill != null && terms.minSpend && bill < terms.minSpend ? { error: "MINIMUM_SPEND_NOT_MET", message: `This reward needs a spend of at least £${terms.minSpend.toFixed(2)}` } : null);
  if (problem) return NextResponse.json({ ...base, ...problem, usable: false }, { status: 400 });

  const discount = bill != null ? rewardDiscount(reward, bill) : null;
  if (!body?.confirm) return NextResponse.json({ ...base, usable: true, discount });

  // Only if still unused — two staff can't use the same code at once.
  const { data: used } = await db.from("loyalty_redemptions")
    .update({ status: "redeemed", redeemed_at: new Date().toISOString(), redeemed_by_staff_id: session.id, redeemed_order_id: null })
    .eq("id", r.id).eq("status", "issued").select("id");
  if (!used?.length) return NextResponse.json({ ...base, error: "ALREADY_REDEEMED", message: "This code has just been used", usable: false }, { status: 409 });

  await db.from("audit_logs").insert({
    staff_id: session.id, action: "loyalty_code_used_without_till", entity_type: "loyalty_redemption", entity_id: r.id,
    changes: { code: r.code, bill, order_type: orderType, discount },
  });
  return NextResponse.json({ ...base, usable: false, used: true, discount });
}
