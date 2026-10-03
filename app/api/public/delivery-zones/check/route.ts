import { NextRequest, NextResponse } from "next/server";
import { checkDeliveryEligibility, getDeliveryConfig } from "@/lib/delivery-zones";
import { requestBusinessId } from "@/lib/business";

export async function GET(req: NextRequest) {
  const postcode = req.nextUrl.searchParams.get("postcode");
  if (!postcode) return NextResponse.json({ error: "postcode is required" }, { status: 400 });

  const bidParam = req.nextUrl.searchParams.get("business_id");
  const businessId = bidParam ? Number(bidParam) : await requestBusinessId(req);
  const config = await getDeliveryConfig(businessId);
  const { deliverable, distanceMiles } = await checkDeliveryEligibility(postcode, businessId);

  if (!deliverable) {
    return NextResponse.json({ deliverable: false, max_miles: config.maxDeliveryMiles });
  }

  return NextResponse.json({
    deliverable: true,
    distance_miles: typeof distanceMiles === "number" ? Math.round(distanceMiles * 10) / 10 : undefined,
    fee: config.deliveryFee,
    free_over: config.freeDeliveryThreshold,
    min_order: config.minDeliveryOrder,
  });
}
