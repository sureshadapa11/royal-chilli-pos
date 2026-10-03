import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { getPaidOrdersInRange, getRefundsByOrderId } from "@/lib/analytics";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "analytics", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "from and to are required" }, { status: 400 });

  const orders = await getPaidOrdersInRange(session.businessId, from, to);
  const refundsByOrder = await getRefundsByOrderId(orders.map((o) => o.id));
  // Net of refunds — a refunded order never has its `total` changed (see
  // getRefundsByOrderId), so revenue here would otherwise still count it at
  // full original value forever.
  const netTotal = (o: { id: number; total: number }) => Number(o.total) - (refundsByOrder.get(o.id) || 0);

  const totalRevenue = Math.round(orders.reduce((s, o) => s + netTotal(o), 0) * 100) / 100;
  const refundsTotal = Math.round([...refundsByOrder.values()].reduce((s, v) => s + v, 0) * 100) / 100;
  const totalOrders = orders.length;
  const avgOrderValue = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;

  const byHour = new Map<number, { orders: number; revenue: number }>();
  const byDay = new Map<string, { orders: number; revenue: number }>();
  for (const o of orders) {
    const d = new Date(o.created_at);
    const hour = d.getUTCHours();
    const day = o.created_at.slice(0, 10);
    const h = byHour.get(hour) || { orders: 0, revenue: 0 };
    h.orders += 1; h.revenue += netTotal(o);
    byHour.set(hour, h);
    const dd = byDay.get(day) || { orders: 0, revenue: 0 };
    dd.orders += 1; dd.revenue += netTotal(o);
    byDay.set(day, dd);
  }

  const hourly = Array.from(byHour.entries())
    .map(([hour, v]) => ({ hour, orders: v.orders, revenue: Math.round(v.revenue * 100) / 100 }))
    .sort((a, b) => a.hour - b.hour);
  const peakHour = hourly.length > 0 ? hourly.reduce((best, h) => (h.orders > best.orders ? h : best), hourly[0]) : null;

  const daily = Array.from(byDay.entries())
    .map(([date, v]) => ({ date, orders: v.orders, revenue: Math.round(v.revenue * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ total_revenue: totalRevenue, refunds_total: refundsTotal, total_orders: totalOrders, avg_order_value: avgOrderValue, hourly, peak_hour: peakHour, daily });
}
