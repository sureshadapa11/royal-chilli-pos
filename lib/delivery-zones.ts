import { DEFAULT_BUSINESS_ID } from "@/lib/business-id";
import { getBusinessSettings } from "@/lib/business-settings";
import { getBusiness } from "@/lib/business";

// Delivery eligibility: calculated radius from the restaurant, computed
// by geocoding postcodes via postcodes.io (a free, no-key-required UK postcode API).
// Scoped per business. Only The Royal Chilli falls back to its Hounslow
// location; another business with no coordinates or postcode set up doesn't
// deliver at all (rather than silently delivering around Hounslow).

const DEFAULT_LAT = 51.471985;
const DEFAULT_LNG = -0.355561;
export const DEFAULT_MAX_DELIVERY_MILES = 5;

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

export async function getDeliveryConfig(businessId: number = DEFAULT_BUSINESS_ID): Promise<DeliveryConfig> {
  const rawSettings = await getBusinessSettings(businessId, [
    "restaurant_latitude",
    "restaurant_longitude",
    "max_delivery_miles",
    "delivery_fee",
    "free_delivery_threshold",
    "min_delivery_order",
  ]).catch(() => ({} as Record<string, unknown>));
  const settings = (rawSettings || {}) as Record<string, unknown>;

  let lat = typeof settings.restaurant_latitude === "number" ? settings.restaurant_latitude : null;
  let lng = typeof settings.restaurant_longitude === "number" ? settings.restaurant_longitude : null;

  if (lat == null || lng == null) {
    if (businessId === DEFAULT_BUSINESS_ID) {
      lat = DEFAULT_LAT;
      lng = DEFAULT_LNG;
    } else {
      const b = await getBusiness(businessId).catch(() => null);
      const postcode = (b?.trading_address as { postcode?: string } | undefined)?.postcode;
      if (postcode) {
        const point = await geocodePostcode(postcode);
        if (point) {
          lat = point.lat;
          lng = point.lng;
        }
      }
    }
  }

  const maxDeliveryMiles = Number(settings.max_delivery_miles) || DEFAULT_MAX_DELIVERY_MILES;
  const deliveryFee = typeof settings.delivery_fee === "number" ? settings.delivery_fee : DELIVERY_FEE;
  const freeDeliveryThreshold = typeof settings.free_delivery_threshold === "number" ? settings.free_delivery_threshold : FREE_DELIVERY_THRESHOLD;
  const minDeliveryOrder = typeof settings.min_delivery_order === "number" ? settings.min_delivery_order : MIN_DELIVERY_ORDER;

  return {
    restaurantLat: lat,
    restaurantLng: lng,
    maxDeliveryMiles,
    deliveryFee,
    freeDeliveryThreshold,
    minDeliveryOrder,
  };
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle distance in miles (haversine formula)
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R_MILES = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function geocodePostcode(postcode: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== 200 || !json.result) return null;
    return { lat: json.result.latitude, lng: json.result.longitude };
  } catch {
    return null;
  }
}

export type DeliveryEligibility = {
  deliverable: boolean;
  distanceMiles?: number;
  config?: DeliveryConfig;
};

export async function checkDeliveryEligibility(
  postcode: string,
  businessId: number = DEFAULT_BUSINESS_ID
): Promise<DeliveryEligibility> {
  const config = await getDeliveryConfig(businessId);
  if (config.restaurantLat == null || config.restaurantLng == null) return { deliverable: false, config };
  const point = await geocodePostcode(postcode);
  if (!point) return { deliverable: false, config };
  const distanceMiles = haversineMiles(config.restaurantLat, config.restaurantLng, point.lat, point.lng);
  return { deliverable: distanceMiles <= config.maxDeliveryMiles, distanceMiles, config };
}

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
