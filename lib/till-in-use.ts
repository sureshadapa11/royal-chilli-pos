import { getBusinessSetting } from "@/lib/business-settings";

/**
 * Is this business taking orders on the till yet? Off until the owner asks
 * (business setting till_in_use = "1"); till-only screens and export sheets
 * stay hidden while it's off, so test orders never show up as sales.
 */
export async function tillInUse(businessId: number): Promise<boolean> {
  return String((await getBusinessSetting(businessId, "till_in_use")) ?? "") === "1";
}
