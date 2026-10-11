"use client";
// TEMPORARY preview with pretend data — never commit.
import { useEffect, useState } from "react";
import BatchesTab from "@/components/staff/BatchesTab";

const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
function installFake() {
  window.fetch = async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.startsWith("/api/storage-areas")) return respond({ areas: [{ id: 1, name: "Walk-in fridge", kind: "fridge" }, { id: 2, name: "Freezer 1", kind: "freezer" }] });
    if (u.startsWith("/api/batches")) return respond({ today: "2026-10-08", batches: [
      { id: 1, name: "Chicken Breast", unit: "kg", storage_area_id: 1, expiry_date: "2026-10-07", received_qty: 5, remaining_qty: 3, received_at: "2026-10-03T08:40:00Z", order_number: "RC-20261003-001", supplier_name: "Fresh Meats Ltd", status: "expired" },
      { id: 2, name: "Paneer", unit: "kg", storage_area_id: 1, expiry_date: "2026-10-08", received_qty: 6, remaining_qty: 2.5, received_at: "2026-10-05T08:40:00Z", order_number: "RC-20261005-002", supplier_name: "Dairy Direct", status: "use_first" },
      { id: 3, name: "Yoghurt", unit: "L", storage_area_id: null, expiry_date: "2026-10-09", received_qty: 10, remaining_qty: 10, received_at: "2026-10-07T08:40:00Z", order_number: "RC-20261007-001", supplier_name: "Dairy Direct", status: "use_first" },
      { id: 4, name: "Chicken Breast", unit: "kg", storage_area_id: 1, expiry_date: "2026-10-12", received_qty: 18, remaining_qty: 18, received_at: "2026-10-08T08:40:00Z", order_number: "RC-20261008-004", supplier_name: "Fresh Meats Ltd", status: "ok" },
      { id: 5, name: "Lamb Leg", unit: "kg", storage_area_id: 2, expiry_date: "2027-01-10", received_qty: 8, remaining_qty: 8, received_at: "2026-10-08T08:40:00Z", order_number: "RC-20261008-004", supplier_name: "Fresh Meats Ltd", status: "ok" },
    ] });
    return respond({});
  };
}
export default function Preview() {
  const [ready, setReady] = useState(false);
  useEffect(() => { installFake(); setReady(true); }, []);
  return <div className="min-h-screen bg-background p-4"><div className="mx-auto max-w-5xl">{ready && <BatchesTab />}</div></div>;
}
