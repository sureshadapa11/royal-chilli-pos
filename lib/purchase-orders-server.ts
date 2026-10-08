import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { getBusinessNumber } from "@/lib/business-settings";
import { canApprovePurchaseOrders } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { APPROVAL_LIMIT_KEY, DEFAULT_APPROVAL_LIMIT, planPoAction, type PoActor } from "@/lib/purchase-orders";

/** Orders over this (£) need approving. Business setting, default £150. */
export function approvalLimit(businessId: number): Promise<number> {
  return getBusinessNumber(businessId, APPROVAL_LIMIT_KEY, DEFAULT_APPROVAL_LIMIT);
}

export function poActor(session: SessionUser): PoActor {
  return { id: session.id, owner: session.owner === true, canApprove: canApprovePurchaseOrders(session.role) };
}

export type PoActionResult =
  | { ok: true; purchaseOrder: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/** Submit / approve / reject / mark sent / cancel one order, for this person. */
export async function applyPoAction(session: SessionUser, poId: number, action: string, comment?: string | null): Promise<PoActionResult> {
  const db = bizDb(session.businessId);
  const { data: po } = await db.from("purchase_orders").select("id, status, total_cost, created_by").eq("id", poId).maybeSingle();
  if (!po) return { ok: false, status: 404, error: "Purchase order not found" };

  const plan = planPoAction(po, action, poActor(session), await approvalLimit(session.businessId), comment);
  if (!plan.ok) return plan;

  const { data, error } = await supabase.rpc("move_purchase_order", {
    p_business_id: session.businessId,
    p_po_id: poId,
    p_from: plan.from,
    p_to: plan.to,
    p_action: plan.event,
    p_staff_id: session.id,
    p_comment: comment ?? null,
  });
  if (error) throw error;
  const result = data as { outcome: string; status?: string; purchase_order?: Record<string, unknown> };
  if (result.outcome === "not_found") return { ok: false, status: 404, error: "Purchase order not found" };
  // Someone else moved it first (two managers pressing Approve at once).
  if (result.outcome !== "moved") return { ok: false, status: 409, error: "Someone else changed this order just now. Refresh and check it." };
  return { ok: true, purchaseOrder: result.purchase_order! };
}
