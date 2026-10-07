import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";

// Every currently-outstanding Pay Later order, across all dates — the
// admin-wide view (Staff Hub → Reports → Pending Bills), as opposed to the
// POS History screen's per-day Pending Bills filter that staff use to find
// and collect payment on a specific one.
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);

    const { data: orders, error } = await db
      .from("orders")
      .select(`
        id, order_number, order_type, total, amount_paid, customer_name, customer_phone,
        pay_later_note, created_at, table_id,
        restaurant_tables(table_number, join_label),
        staff:staff!orders_staff_id_fkey(name)
      `)
      .eq("pay_later", true)
      .eq("is_paid", false)
      .not("status", "eq", "cancelled")
      .order("created_at", { ascending: true });

    if (error) throw error;

    const flat = (orders ?? []).map((o) => {
      const { restaurant_tables: rt, staff: s, ...rest } = o as typeof o & {
        restaurant_tables: { table_number: string; join_label?: string | null } | null;
        staff: { name: string } | null;
      };
      return {
        ...rest,
        table_number: (rt?.join_label || rt?.table_number) ?? null,
        staff_name: s?.name ?? null,
        outstanding: Math.round((Number(o.total) - Number(o.amount_paid)) * 100) / 100,
      };
    });

    const total = Math.round(flat.reduce((s, o) => s + o.outstanding, 0) * 100) / 100;

    return NextResponse.json({ orders: flat, total });
  } catch (error) {
    console.error("Pending bills fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch pending bills" }, { status: 500 });
  }
}
