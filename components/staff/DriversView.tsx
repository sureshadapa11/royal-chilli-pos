"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { confirmDelete } from "@/components/ui/confirm";

type Driver = { id: number; name: string; phone: string | null; vehicle_type: string | null; vehicle_registration: string | null; driver_status: string; delivered_count: number; delivered_value: number };
type UnassignedOrder = { id: number; order_number: string; customer_name: string; customer_phone: string; customer_address: string; total: number };
type MyDelivery = { id: number; order_number: string; customer_name: string; customer_phone: string; customer_address: string; total: number; delivery_status: string };

function fmtMoney(n: number) { return `£${Number(n).toFixed(2)}`; }

function ManagerPanel() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedOrder[]>([]);
  const [assignFor, setAssignFor] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [dRes, oRes] = await Promise.all([fetch("/api/drivers"), fetch("/api/drivers/unassigned-orders")]);
    setDrivers((await dRes.json()).drivers || []);
    setUnassigned((await oRes.json()).orders || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function assign(orderId: number, driverId: number) {
    await fetch(`/api/orders/${orderId}/assign-driver`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ driver_id: driverId }) });
    setAssignFor(null);
    load();
  }

  const statusColor: Record<string, string> = { available: "text-emerald-600", on_delivery: "text-amber-600", offline: "text-muted-foreground" };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-muted-foreground text-xs font-bold uppercase tracking-widest mb-2">Unassigned Deliveries</h2>
        <div className="space-y-2">
          {unassigned.map((o) => (
            <div key={o.id} className="rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] px-4 py-3 flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-foreground font-semibold">{o.order_number} · {o.customer_name}</p>
                <p className="text-muted-foreground text-sm">{o.customer_address} · {fmtMoney(o.total)}</p>
              </div>
              {assignFor === o.id ? (
                <div className="flex gap-2 flex-wrap">
                  {drivers.map((d) => (
                    <button key={d.id} onClick={() => assign(o.id, d.id)} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg">{d.name}</button>
                  ))}
                </div>
              ) : (
                <button onClick={() => setAssignFor(o.id)} className="px-3 py-1.5 bg-elevated hover:bg-elevated-hover text-foreground text-xs font-bold rounded-lg">Assign Driver</button>
              )}
            </div>
          ))}
          {unassigned.length === 0 && <p className="text-muted-foreground text-sm text-center py-6">No unassigned deliveries.</p>}
        </div>
      </div>

      <div>
        <h2 className="text-muted-foreground text-xs font-bold uppercase tracking-widest mb-2">Driver Roster</h2>
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-muted-foreground"><tr><th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Vehicle</th><th className="text-left px-3 py-2">Status</th><th className="text-right px-3 py-2">Delivered</th><th className="text-right px-3 py-2">Value</th></tr></thead>
            <tbody className="divide-y divide-border">
              {drivers.map((d) => (
                <tr key={d.id} className="bg-background">
                  <td className="px-3 py-2 text-foreground font-medium">{d.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{[d.vehicle_type, d.vehicle_registration].filter(Boolean).join(" · ") || "—"}</td>
                  <td className={`px-3 py-2 font-semibold ${statusColor[d.driver_status] || "text-muted-foreground"}`}>{(d.driver_status || "offline").replace("_", " ")}</td>
                  <td className="px-3 py-2 text-right text-foreground">{d.delivered_count}</td>
                  <td className="px-3 py-2 text-right text-foreground">{fmtMoney(d.delivered_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {drivers.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No drivers yet — add one from Employees with role &ldquo;Driver&rdquo;.</p>}
        </div>
      </div>
    </div>
  );
}

function DriverPanel() {
  const [deliveries, setDeliveries] = useState<MyDelivery[]>([]);
  const [status, setStatus] = useState("offline");

  const load = useCallback(async () => {
    const res = await fetch("/api/drivers/my-deliveries");
    const data = await res.json();
    setDeliveries(data.deliveries || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setMyStatus(s: string) {
    setStatus(s);
    await fetch("/api/drivers/status", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: s }) });
  }

  async function advance(orderId: number, next: string) {
    await fetch(`/api/orders/${orderId}/delivery-status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    load();
  }

  return (
    <div>
      <div className="flex gap-2">
        {(["available", "on_delivery", "offline"] as const).map((s) => (
          <button key={s} onClick={() => setMyStatus(s)} className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize ${status === s ? "bg-red-600 text-white" : "bg-surface-hover text-muted-foreground border border-border"}`}>
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-2">
        {deliveries.map((d) => (
          <div key={d.id} className="rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] px-4 py-3">
            <p className="text-foreground font-semibold">{d.order_number} · {d.customer_name}</p>
            <p className="text-muted-foreground text-sm">{d.customer_address} · {fmtMoney(d.total)}</p>
            <p className="text-muted-foreground text-sm">📞 <a href={`tel:${d.customer_phone}`} className="text-blue-600">{d.customer_phone}</a></p>
            <div className="mt-2">
              {d.delivery_status === "assigned" && <button onClick={() => advance(d.id, "out_for_delivery")} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg">🚗 Start Delivery</button>}
              {d.delivery_status === "out_for_delivery" && <button onClick={() => advance(d.id, "delivered")} className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg">✓ Mark Delivered</button>}
            </div>
          </div>
        ))}
        {deliveries.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No active deliveries assigned to you.</p>}
      </div>
    </div>
  );
}

type DeliveryZone = { id: number; name: string; postcode_prefixes: string[]; fee: number; min_order: number; active: number };

function ZoneModal({ zone, onClose, onSaved }: { zone: DeliveryZone | "new"; onClose: () => void; onSaved: () => void }) {
  const isNew = zone === "new";
  const [name, setName] = useState(isNew ? "" : zone.name);
  const [prefixes, setPrefixes] = useState(isNew ? "" : zone.postcode_prefixes.join(", "));
  const [fee, setFee] = useState(isNew ? "0" : String(zone.fee));
  const [minOrder, setMinOrder] = useState(isNew ? "0" : String(zone.min_order));
  const { toast } = useToast();

  async function save() {
    const prefixList = prefixes.split(",").map((p) => p.trim()).filter(Boolean);
    if (!name.trim() || prefixList.length === 0) return toast({ variant: "destructive", title: "Name and at least one postcode prefix are required" });
    const payload = { name: name.trim(), postcode_prefixes: prefixList, fee: Number(fee) || 0, min_order: Number(minOrder) || 0 };
    const res = isNew
      ? await fetch("/api/delivery-zones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch(`/api/delivery-zones/${zone.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) return toast({ variant: "destructive", title: "Couldn't save zone", description: data.error });
    toast({ variant: "success", title: isNew ? "Zone added" : "Zone updated", description: name.trim() });
    onSaved(); onClose();
  }

  async function remove() {
    if (isNew) return;
    if (!(await confirmDelete(`the delivery zone “${zone.name}”`))) return;
    const res = await fetch(`/api/delivery-zones/${zone.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      return toast({ variant: "destructive", title: "Couldn't delete zone", description: data.error });
    }
    toast({ variant: "success", title: "Zone deleted", description: zone.name });
    onSaved(); onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto p-5">
        <h2 className="text-foreground font-bold text-lg">{isNew ? "New Delivery Zone" : zone.name}</h2>
        <div className="mt-4 space-y-2">
          <input placeholder="Zone name (e.g. Hounslow Central)" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
          <div>
            <input placeholder="Postcode prefixes, comma-separated (e.g. TW3, TW4)" value={prefixes} onChange={(e) => setPrefixes(e.target.value)} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
            <p className="mt-1 text-muted-foreground text-xs">A more specific prefix (e.g. &ldquo;TW3&rdquo;) wins over a broader one (e.g. &ldquo;TW&rdquo;) covering the same postcode.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-muted-foreground text-xs">Delivery fee (£)</label>
              <input type="number" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
            </div>
            <div>
              <label className="text-muted-foreground text-xs">Min order (£)</label>
              <input type="number" step="0.01" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className="flex-1 h-10 bg-elevated hover:bg-elevated-hover text-foreground font-semibold rounded-xl">Cancel</button>
          {!isNew && <button onClick={remove} className="flex-1 h-10 bg-red-100 hover:bg-red-200 text-red-700 font-semibold rounded-xl text-sm">Delete</button>}
          <button onClick={save} className="flex-1 h-10 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl">Save</button>
        </div>
      </div>
    </div>
  );
}

function DeliveryZonesPanel() {
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [modal, setModal] = useState<DeliveryZone | "new" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/delivery-zones");
    setZones((await res.json()).zones || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex justify-end"><button onClick={() => setModal("new")} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg">+ New Zone</button></div>
      <div className="mt-3 space-y-2">
        {zones.map((z) => (
          <button key={z.id} onClick={() => setModal(z)} className={`w-full text-left rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] px-4 py-3 hover:border-border ${!z.active ? "opacity-50" : ""}`}>
            <p className="text-foreground font-semibold">{z.name} <span className="text-muted-foreground text-xs">({z.postcode_prefixes.join(", ")})</span></p>
            <p className="text-muted-foreground text-sm mt-1">{fmtMoney(z.fee)} delivery fee{z.min_order > 0 ? ` · ${fmtMoney(z.min_order)} minimum order` : ""}</p>
          </button>
        ))}
        {zones.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No delivery zones yet — deliveries will be rejected until at least one zone exists.</p>}
      </div>
      {modal && <ZoneModal zone={modal} onClose={() => setModal(null)} onSaved={load} />}
    </div>
  );
}

export default function DriversView({ isManager, isDriver }: { isManager: boolean; isDriver: boolean }) {
  const [tab, setTab] = useState<"drivers" | "zones">("drivers");
  return (
    <>
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur px-4 py-4">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-foreground text-[22px] font-semibold tracking-[-0.02em]">{isDriver && !isManager ? "My Deliveries" : "Drivers"}</h1>
              <p className="text-muted-foreground text-sm">{isDriver && !isManager ? "Your assigned deliveries and availability." : "Driver roster, live deliveries and who's assigned to what."}</p>
            </div>
          </div>

          {isManager && (
            <div className="flex flex-wrap gap-1 mt-4 bg-surface-hover p-1 rounded-xl">
              <button onClick={() => setTab("drivers")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${tab === "drivers" ? "bg-red-500 text-white" : "text-muted-foreground"}`}>Drivers</button>
              <button onClick={() => setTab("zones")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${tab === "zones" ? "bg-red-500 text-white" : "text-muted-foreground"}`}>Delivery Zones</button>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-6">
      <div className="mx-auto max-w-4xl">
        <div className="mt-5">
          {isDriver && tab === "drivers" && <DriverPanel />}
          {isManager && tab === "drivers" && <div className={isDriver ? "mt-8" : ""}><ManagerPanel /></div>}
          {isManager && tab === "zones" && <DeliveryZonesPanel />}
          {!isManager && !isDriver && <p className="text-muted-foreground text-sm text-center py-16">You don&apos;t have access to this page.</p>}
        </div>
      </div>
      </div>
    </>
  );
}
