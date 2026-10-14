import type { Metadata } from "next";
import { getActiveMenu } from "@/lib/menu";
import { pageBusinessId } from "@/lib/business";
import OrderMenu from "@/components/site/OrderMenu";
import { getDeliveryConfig } from "@/lib/delivery-zones";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Order Online — The Royal Chilli",
  description: "Order authentic Indian food online for collection or delivery from The Royal Chilli, Hounslow.",
};

export default async function OrderPage() {
  // "online" channel: website prices, and only items flagged online_available
  // (Breakfast / Lunch Combos / Combos are off the website by that flag).
  const businessId = await pageBusinessId();
  const [categories, d] = await Promise.all([getActiveMenu(businessId, "online"), getDeliveryConfig(businessId)]);
  // Delivery fee and minimum shown up front, not only at checkout (customer test 2026-10-14).
  const delivery = { fee: d.deliveryFee, freeOver: d.freeDeliveryThreshold, minOrder: d.minDeliveryOrder, miles: d.maxDeliveryMiles };
  return <OrderMenu categories={categories} delivery={delivery} />;
}
