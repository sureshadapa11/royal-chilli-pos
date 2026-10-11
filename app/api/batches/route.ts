import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { resolveInventoryLocation } from "@/lib/locations";
import { londonDateStr } from "@/lib/london-date";
import { expiryStatus } from "@/lib/batches";

// GET — the branch's dated stock still on the shelf, earliest use-by first.
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const location = await resolveInventoryLocation(session.businessId, session.id, null, session.owner);
    if ("error" in location) return NextResponse.json({ error: location.error }, { status: location.status });

    const { data, error } = await bizDb(session.businessId).from("inventory_batches")
      .select("id, ingredient_id, storage_area_id, expiry_date, received_qty, remaining_qty, received_at, ingredient:ingredients(name, unit), item:purchase_order_items(po:purchase_orders(order_number, supplier:suppliers(name)))")
      .eq("location_id", location.locationId)
      .gt("remaining_qty", 0)
      .order("expiry_date").order("id")
      .limit(500);
    if (error) throw error;

    const today = londonDateStr();
    const batches = (data ?? []).map((b) => {
      const { ingredient, item, ...rest } = b as unknown as typeof b & {
        ingredient: { name: string; unit: string } | null;
        item: { po: { order_number: string; supplier: { name: string } | null } | null } | null;
      };
      return {
        ...rest,
        name: ingredient?.name ?? "—",
        unit: ingredient?.unit ?? "",
        order_number: item?.po?.order_number ?? null,
        supplier_name: item?.po?.supplier?.name ?? null,
        status: expiryStatus(b.expiry_date, today),
      };
    });
    return NextResponse.json({ batches, today });
  } catch (error) {
    console.error("Batches fetch error:", error);
    return NextResponse.json({ error: "Failed to load batches" }, { status: 500 });
  }
}
