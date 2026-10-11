import { bizDb } from "@/lib/business-db";
import { isManagerRole } from "@/lib/roles";
import type { StaffRole } from "@/lib/types";
import { canAccess, canEdit } from "@/lib/permissions";
import { londonDateStr, tradingDayStr, tradingRangeUtc } from "@/lib/london-date";
import { expiryStatus, useFirstUntil } from "@/lib/batches";

// Things waiting on someone, shown under the Staff Hub's Notifications menu.
// Worked out fresh each time the Hub loads — nothing is stored.
export type HubNotice = { icon: string; text: string; sub?: string; href: string };

export async function getHubNotifications(businessId: number, role: StaffRole): Promise<HubNotice[]> {
  const db = bizDb(businessId);
  const today = tradingDayStr();
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  const yesterday = d.toISOString().slice(0, 10);
  const isManagement = isManagerRole(role);

  const [ingredients, dated, toApprove, leave, corrections, openDay, platforms, dailyAccounts] = await Promise.all([
    canAccess(role, "inventory") ? db.from("ingredients").select("name, current_stock, reorder_level").eq("active", 1) : null,
    canAccess(role, "inventory")
      ? db.from("inventory_batches").select("expiry_date").gt("remaining_qty", 0).lte("expiry_date", useFirstUntil(londonDateStr())) : null,
    canEdit(role, "approve_purchase_orders")
      ? db.from("purchase_orders").select("id", { count: "exact", head: true }).eq("status", "awaiting_approval") : null,
    canAccess(role, "hr") || canAccess(role, "attendance")
      ? db.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending") : null,
    canAccess(role, "attendance")
      ? db.from("attendance_corrections").select("id", { count: "exact", head: true }).eq("status", "pending") : null,
    isManagement
      ? db.from("work_periods").select("id", { count: "exact", head: true }).eq("status", "open").lt("opened_at", tradingRangeUtc(today).start) : null,
    canAccess(role, "delivery_platforms")
      ? db.from("platform_sales").select("id", { count: "exact", head: true }).eq("sales_date", yesterday) : null,
    canAccess(role, "daily_accounts")
      ? db.from("daily_accounts").select("status").eq("trading_date", yesterday).maybeSingle() : null,
  ]);

  const out: HubNotice[] = [];
  const low = (ingredients?.data ?? []).filter((i) => Number(i.current_stock) <= Number(i.reorder_level));
  if (low.length) {
    out.push({
      icon: "📦",
      text: low.length === 1 ? `Low stock: ${low[0].name}` : `${low.length} items low on stock`,
      sub: low.length > 1 ? low.slice(0, 3).map((i) => i.name).join(", ") + (low.length > 3 ? "…" : "") : undefined,
      href: "/staff/inventory",
    });
  }
  const todayUk = londonDateStr();
  const expired = (dated?.data ?? []).filter((b) => expiryStatus(b.expiry_date, todayUk) === "expired").length;
  const useFirst = (dated?.data ?? []).length - expired;
  if (expired > 0) {
    out.push({ icon: "🗑️", text: expired === 1 ? "1 batch past its use-by" : `${expired} batches past their use-by`, sub: "Bin them in Inventory → Batches", href: "/staff/inventory?tab=batches" });
  }
  if (useFirst > 0) {
    out.push({ icon: "⏳", text: useFirst === 1 ? "1 batch to use first" : `${useFirst} batches to use first`, sub: "Use-by today or tomorrow", href: "/staff/inventory?tab=batches" });
  }
  const approvals = toApprove?.error ? 0 : toApprove?.count ?? 0;
  if (approvals > 0) {
    out.push({ icon: "✅", text: approvals === 1 ? "1 purchase order to approve" : `${approvals} purchase orders to approve`, sub: "Over the approval limit", href: "/staff/inventory?tab=orders" });
  }
  if (openDay && (openDay.count ?? 0) > 0) {
    out.push({ icon: "🧾", text: "Close Day not done", sub: "An earlier day is still open on the till", href: "/pos" });
  }
  const pending = (leave?.count ?? 0) + (corrections?.count ?? 0);
  if (pending > 0) {
    out.push({ icon: "🕐", text: `${pending} waiting for approval`, sub: "Leave requests & time corrections", href: "/api/sso/attendance" });
  }
  if (platforms && !platforms.error && (platforms.count ?? 0) === 0) {
    out.push({ icon: "🛵", text: "Enter yesterday's platform totals", sub: "Just Eat, Uber Eats, Deliveroo, Hiest", href: "/staff/platforms" });
  }
  if (dailyAccounts && !dailyAccounts.error && dailyAccounts.data?.status !== "submitted") {
    out.push({
      icon: "🧮",
      text: dailyAccounts.data ? "Submit yesterday's daily accounts" : "Enter yesterday's daily accounts",
      sub: dailyAccounts.data ? "Saved as a draft, not submitted" : "The day-end sheet",
      href: `/staff/daily-accounts?date=${yesterday}`,
    });
  }
  return out;
}
