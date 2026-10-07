import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET — orders customers placed themselves (website + table QR) whose
// kitchen ticket is due, from the last few hours. Drives the till's
// new-order chime (components/pos/NewOrderAlerts.tsx), which remembers which
// ones staff have marked Seen. Keyed off the kitchen-ticket queue, so a QR
// table's later round, a pay-online order once Stripe confirms, and a
// scheduled order at its prep time each alert exactly when the kitchen
// ticket appears.
const WINDOW_MS = 6 * 60 * 60 * 1000;

type Row = {
  id: number;
  source: "online" | "qr";
  print_after: string;
  order: { order_number: string; order_type: string; status: string; customer_name: string | null; restaurant_tables: { table_number: string; join_label?: string | null } | null } | null;
};

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = Date.now();
  const { data, error } = await bizDb(session.businessId)
    .from("print_jobs")
    .select("id, source, print_after, order:orders(order_number, order_type, status, customer_name, restaurant_tables(table_number, join_label))")
    .eq("kind", "kot")
    .in("source", ["online", "qr"])
    .lte("print_after", new Date(now).toISOString())
    .gte("print_after", new Date(now - WINDOW_MS).toISOString())
    .order("id", { ascending: true });
  if (error) return NextResponse.json({ error: "Failed to load" }, { status: 500 });

  const alerts = ((data ?? []) as unknown as Row[])
    .filter((r) => r.order && r.order.status !== "cancelled")
    .map((r) => ({
      id: r.id,
      source: r.source,
      order_number: r.order!.order_number,
      order_type: r.order!.order_type,
      table_number: (r.order!.restaurant_tables?.join_label || r.order!.restaurant_tables?.table_number) ?? null,
      customer_name: r.order!.customer_name,
      at: r.print_after,
    }));
  return NextResponse.json({ alerts });
}
