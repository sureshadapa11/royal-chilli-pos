// Delivery fees and thresholds — no server imports, so the checkout page
// (a client component) can use them. Per-business values come from
// getDeliveryConfig in lib/delivery-zones (server-only).

export const DELIVERY_FEE = 3.5;
export const FREE_DELIVERY_THRESHOLD = 25;
export const MIN_DELIVERY_ORDER = 10;

export type DeliveryConfig = {
  restaurantLat: number | null;
  restaurantLng: number | null;
  maxDeliveryMiles: number;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  minDeliveryOrder: number;
};

// Delivery fee calculation, supporting business config and default thresholds
export function computeDeliveryFee(
  subtotal: number,
  configOrFee?: Partial<DeliveryConfig> | number
): number {
  if (typeof configOrFee === "number") {
    return subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : configOrFee;
  }
  const threshold = configOrFee?.freeDeliveryThreshold ?? FREE_DELIVERY_THRESHOLD;
  const fee = configOrFee?.deliveryFee ?? DELIVERY_FEE;
  return subtotal >= threshold ? 0 : fee;
}
