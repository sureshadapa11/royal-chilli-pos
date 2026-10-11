import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { redemptionProblem } from "@/lib/loyalty";

// Read-only lookup — lets staff preview a code (name, discount, expiry)
// before committing to /redeem against a specific order.
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { code } = await req.json();
  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 });

  const { data: redemption, error } = await db
    .from("loyalty_redemptions")
    .select("*, reward:loyalty_rewards(name, description, discount_amount, discount_pct, max_discount, order_types, min_spend), customer:customers(name, phone)")
    .eq("code", String(code).trim().toUpperCase())
    .maybeSingle();
  if (error || !redemption) return NextResponse.json({ error: "INVALID_CODE", message: "No reward found with that code" }, { status: 404 });

  const problem = redemptionProblem(redemption);
  if (problem) return NextResponse.json(problem, { status: 400 });

  return NextResponse.json({ valid: true, redemption });
}
