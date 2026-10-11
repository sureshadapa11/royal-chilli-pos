import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { estimatePurchasePoints } from "@/lib/customers";
import { getCashCreditInfo, rewardMinSpend } from "@/lib/loyalty";
import { upcomingVisitBonus } from "@/lib/visits";

// Read-only preview for the payment screen: how many points this order
// would earn right now, plus the customer's current balance — both real
// numbers (same calc as the actual award), not guesses.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const customerId = Number(searchParams.get("customer_id"));
  const amount = Number(searchParams.get("amount"));
  const orderId = Number(searchParams.get("order_id")) || null;
  if (!customerId || isNaN(amount)) {
    return NextResponse.json({ error: "customer_id and amount are required" }, { status: 400 });
  }

  const { data: customer } = await bizDb(session.businessId).from("customers").select("loyalty_points, name").eq("id", customerId).maybeSingle();
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const estimate = await estimatePurchasePoints(customerId, amount);
  const minSpend = await rewardMinSpend(session.businessId);
  const cashCredit = await getCashCreditInfo(session.businessId, customer.loyalty_points);
  // A bill with nothing to pay earns no points, so no visit bonus either
  // (the bonus follows the purchase points).
  const visitBonus = amount > 0.009 ? await upcomingVisitBonus(customerId) : { visit: 0, points: 0 };
  // Points and vouchers are dine-in only (Rewards Club)
  let canSpend = true;
  if (orderId) {
    const { data: order } = await bizDb(session.businessId).from("orders").select("order_type").eq("id", orderId).maybeSingle();
    canSpend = order?.order_type === "dine_in";
  }

  return NextResponse.json({
    customer_name: customer.name,
    current_balance: customer.loyalty_points,
    will_earn: estimate.total + visitBonus.points,
    visit_number: visitBonus.visit,
    visit_bonus: visitBonus.points,
    tier_name: estimate.tierName,
    double_day: estimate.doubleDay,
    can_spend: canSpend,
    reward_min_spend: minSpend,
    cash_credit: cashCredit,
  });
}
