import { NextRequest, NextResponse } from "next/server";
import { websiteBusinessId } from "@/lib/business";
import { DEFAULT_REWARD_MIN_SPEND, getLoyaltySetting } from "@/lib/loyalty";

// GET — the website's Rewards Club rules that client pages show (sign-up).
export async function GET(req: NextRequest) {
  const businessId = await websiteBusinessId(req.headers.get("host"));
  const minSpend = await getLoyaltySetting(businessId, "loyalty_reward_min_spend", DEFAULT_REWARD_MIN_SPEND);
  return NextResponse.json({ min_spend: minSpend }, { headers: { "Cache-Control": "public, max-age=300" } });
}
