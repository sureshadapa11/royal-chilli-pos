import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageFinance } from "@/lib/permissions";
import { bizDb } from "@/lib/business-db";
import { PLATFORMS } from "@/lib/platforms";

// Daily delivery-platform totals (Just Eat / Uber Eats / Deliveroo / Hiest), typed in
// from each tablet's end-of-day summary. Anyone with the Finance tab.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = new Set<string>(PLATFORMS.map((p) => p.key));

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageFinance(session.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = bizDb(session.businessId);
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  const { data, error } = await db
    .from("platform_sales")
    .select("sales_date, platform, orders, sales, commission")
    .gte("sales_date", from)
    .lte("sales_date", to)
    .order("sales_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

// Save one day: { date, rows: [{ platform, orders, sales, commission }] }.
// A platform left blank (all zero) for the day is removed.
export async function PUT(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageFinance(session.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = bizDb(session.businessId);
  const body = await req.json().catch(() => null);
  const date = String(body?.date ?? "");
  if (!DATE.test(date)) return NextResponse.json({ error: "Pick a date" }, { status: 400 });
  const rows = Array.isArray(body?.rows) ? body.rows : [];

  const keep: { platform: string; orders: number; sales: number; commission: number }[] = [];
  const clear: string[] = [];
  for (const r of rows) {
    const platform = String(r?.platform ?? "");
    if (!KEYS.has(platform)) continue;
    const orders = Math.round(Number(r.orders) || 0);
    const sales = Math.round((Number(r.sales) || 0) * 100) / 100;
    const commission = Math.round((Number(r.commission) || 0) * 100) / 100;
    if (orders < 0 || sales < 0 || commission < 0) return NextResponse.json({ error: "Numbers can't be negative" }, { status: 400 });
    if (commission > sales) return NextResponse.json({ error: "Commission can't be more than sales" }, { status: 400 });
    if (orders === 0 && sales === 0 && commission === 0) clear.push(platform);
    else keep.push({ platform, orders, sales, commission });
  }

  if (keep.length) {
    const { error } = await db.from("platform_sales").upsert(
      keep.map((k) => ({ ...k, sales_date: date, entered_by: session.id, updated_at: new Date().toISOString() })),
      { onConflict: "business_id,sales_date,platform" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (clear.length) {
    await db.from("platform_sales").delete().eq("sales_date", date).in("platform", clear);
  }
  await db.from("audit_logs").insert({
    staff_id: session.id, action: "platform_sales_saved", entity_type: "platform_sales", entity_id: null,
    changes: { date, rows: keep, cleared: clear },
  });
  return NextResponse.json({ ok: true });
}
