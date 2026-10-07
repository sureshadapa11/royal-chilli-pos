"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useBrand } from "@/components/pos/useBrand";
import Link from "next/link";
import type { RestaurantTable } from "@/lib/types";
import { isValidEmail, isValidUkMobile } from "@/lib/utils";
import { londonDateStr } from "@/lib/london-date";
import TableRequestsBanner from "@/components/pos/TableRequestsBanner";
import { useToast } from "@/hooks/use-toast";
import { canMarkNoShow, canSeatNow, shortDate } from "@/lib/reservation-rules";

const tableStatusCfg = {
  available: { color: "bg-green-100 border-green-300 text-green-700", dot: "bg-green-500", ring: "ring-green-500" },
  occupied:  { color: "bg-red-100 border-red-300 text-red-700",       dot: "bg-red-500",   ring: "ring-red-500"   },
  reserved:  { color: "bg-yellow-100 border-yellow-300 text-yellow-700", dot: "bg-yellow-500", ring: "ring-yellow-500" },
};

const resvStatusCfg: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: "Pending",   color: "text-yellow-700", bg: "bg-yellow-500/10 border-yellow-500/40" },
  confirmed: { label: "Confirmed", color: "text-blue-700",   bg: "bg-blue-500/10 border-blue-500/40"    },
  seated:    { label: "Seated",    color: "text-emerald-700",bg: "bg-emerald-500/10 border-emerald-500/40" },
  cancelled: { label: "Cancelled", color: "text-red-700",    bg: "bg-red-50 border-red-300"      },
  no_show:   { label: "No Show",   color: "text-muted-foreground",   bg: "bg-surface-hover/60 border-border"       },
  waitlisted:{ label: "Waitlisted",color: "text-purple-700",  bg: "bg-purple-500/10 border-purple-500/40" },
};

interface Reservation {
  id: number;
  customer_name: string;
  customer_phone?: string;
  party_size: number;
  reservation_date: string;
  reservation_time: string;
  table_number?: string;
  table_id?: number;
  notes?: string;
  status: string;
  source?: string;
}

// Reservation dates are UK calendar dates (lib/london-date.ts), not UTC —
// otherwise between midnight and 1am in summer "Today" showed yesterday.
function todayStr() {
  return londonDateStr();
}

function tomorrowStr() {
  const d = new Date(`${londonDateStr()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function fmtTime(t: string) {
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

function dayLabel(dateStr: string) {
  if (dateStr === todayStr()) return "Today";
  if (dateStr === tomorrowStr()) return "Tomorrow";
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

// ── Table Picker Modal — assign a table when seating a booking ─────────────
function TablePickerModal({
  reservation,
  tables,
  onConfirm,
  onClose,
}: {
  reservation: Reservation;
  tables: RestaurantTable[];
  onConfirm: (tableId: number) => Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(reservation.table_id ?? null);
  const [saving, setSaving] = useState(false);

  const groups = {
    main:    tables.filter(t => t.location === "main"),
    outdoor: tables.filter(t => t.location === "outdoor"),
    private: tables.filter(t => t.location === "private"),
  };

  const handleSeat = async () => {
    if (!selected) return;
    setSaving(true);
    await onConfirm(selected);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-foreground font-bold text-lg">Allocate Table</h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            {reservation.customer_name} · {fmtTime(reservation.reservation_time)} · 👥 {reservation.party_size} guests
          </p>
        </div>

        {/* Legend */}
        <div className="px-5 pt-3 flex gap-4">
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /><span className="text-green-700 text-xs">Available</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /><span className="text-red-700 text-xs">Occupied</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-yellow-500" /><span className="text-yellow-700 text-xs">Reserved</span></div>
        </div>

        {/* Table grid */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-5">
          {Object.entries(groups).map(([loc, locTables]) => {
            if (locTables.length === 0) return null;
            const locLabel = loc === "main" ? "Main Floor" : loc === "outdoor" ? "Outdoor" : "Private Room";
            return (
              <div key={loc}>
                <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest mb-2">{locLabel}</p>
                <div className="grid grid-cols-4 gap-2">
                  {locTables.map(table => {
                    const cfg = tableStatusCfg[table.status];
                    const isSelected = selected === table.id;
                    const isUnavailable = table.status === "occupied";
                    return (
                      <button
                        key={table.id}
                        disabled={isUnavailable}
                        onClick={() => setSelected(isSelected ? null : table.id)}
                        className={[
                          "rounded-xl border-2 p-3 text-center transition-all",
                          isUnavailable ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:scale-105",
                          isSelected
                            ? `${cfg.color} ring-2 ${cfg.ring} ring-offset-1 ring-offset-background scale-105`
                            : cfg.color,
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-lg font-black">{table.table_number}</span>
                          <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                        </div>
                        <div className="text-[10px] opacity-70">{table.capacity} seats</div>
                        {isSelected && <div className="text-[10px] font-bold mt-1">✓ Selected</div>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Seat size hint */}
        {selected && (() => {
          const t = tables.find(t => t.id === selected);
          const fits = t && t.capacity >= reservation.party_size;
          return !fits ? (
            <div className="mx-5 mb-2 text-xs text-amber-700 bg-amber-100 border border-amber-300/40 rounded-lg px-3 py-2">
              ⚠️ Table {t?.table_number} seats {t?.capacity} — party is {reservation.party_size}. Confirm anyway?
            </div>
          ) : null;
        })()}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex gap-3">
          <button onClick={onClose}
            className="flex-1 h-11 bg-elevated hover:bg-elevated-hover border border-elevated text-foreground font-semibold rounded-xl transition-all">
            Cancel
          </button>
          <button
            onClick={handleSeat}
            disabled={!selected || saving}
            className="flex-1 h-11 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-bold rounded-xl transition-all"
          >
            {saving ? "Seating…" : selected ? `🪑 Seat at Table ${tables.find(t => t.id === selected)?.table_number}` : "Select a Table"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New Reservation Modal — date + time + party size, no table yet ─────────
function NewReservationModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState("19:00");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim() || !date || !time || !phone.trim() || !email.trim()) {
      setErr("Name, phone, email, date and time are required");
      return;
    }
    if (!isValidUkMobile(phone)) {
      setErr("Please enter a valid UK mobile number (starts with 07, 11 digits)");
      return;
    }
    if (!isValidEmail(email)) {
      setErr("Please enter a valid email address");
      return;
    }
    setSaving(true);
    setErr("");
    const res = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        customer_email: email.trim(),
        party_size: Number(partySize) || 2,
        reservation_date: date,
        reservation_time: time,
        notes: notes.trim() || undefined,
        source: "pos",
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setErr("Failed to create the booking");
      return;
    }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-foreground font-bold text-lg">New Reservation</h2>
          <p className="text-muted-foreground text-sm mt-0.5">A table gets assigned later, when they're seated.</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Customer name"
            className="w-full bg-surface-hover border border-elevated text-foreground text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-red-500" />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Mobile number (07…)" type="tel" inputMode="numeric" maxLength={11}
            className="w-full bg-surface-hover border border-elevated text-foreground text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-red-500" />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email — for confirmation" type="email" required
            className="w-full bg-surface-hover border border-elevated text-foreground text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-red-500" />
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-muted-foreground">
              Date
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="mt-1 w-full bg-surface-hover border border-elevated text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-red-500" />
            </label>
            <label className="text-xs text-muted-foreground">
              Time
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="mt-1 w-full bg-surface-hover border border-elevated text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-red-500" />
            </label>
          </div>
          <label className="block text-xs text-muted-foreground">
            Party size
            <input type="number" min={1} value={partySize} onChange={e => setPartySize(e.target.value)}
              className="mt-1 w-full bg-surface-hover border border-elevated text-foreground text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-red-500" />
          </label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2}
            className="w-full bg-surface-hover border border-elevated text-foreground text-sm rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-red-500" />
          {err && <p className="text-red-600 text-sm">{err}</p>}
        </div>
        <div className="px-5 py-4 border-t border-border flex gap-3">
          <button onClick={onClose} className="flex-1 h-11 bg-elevated hover:bg-elevated-hover border border-elevated text-foreground font-semibold rounded-xl transition-all">
            Cancel
          </button>
          <button onClick={submit} disabled={saving} className="flex-1 h-11 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all">
            {saving ? "Saving…" : "Add Booking"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function ReservationsPage() {
  const brand = useBrand();
  const [tables, setTables] = useState<RestaurantTable[]>([]);

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [resvLoading, setResvLoading] = useState(true);
  const [updating, setUpdating] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  // Table picker modal
  const [seatResv, setSeatResv] = useState<Reservation | null>(null);
  const { toast } = useToast();

  const fetchTables = useCallback(async () => {
    const res = await fetch("/api/tables");
    const data = await res.json();
    setTables(data.tables || []);
  }, []);

  const fetchReservations = useCallback(async () => {
    setResvLoading(true);
    const res = await fetch(`/api/reservations?from=${todayStr()}`);
    const data = await res.json();
    setReservations(data.reservations || []);
    setResvLoading(false);
  }, []);

  useEffect(() => {
    fetchTables();
    const t = setInterval(fetchTables, 15000);
    return () => clearInterval(t);
  }, [fetchTables]);

  useEffect(() => {
    fetchReservations();
  }, [fetchReservations]);

  // Clears the "new bookings" badge on the POS header button — staff opening
  // this page counts as having seen everything up to now, regardless of
  // which of those reservations are still pending.
  useEffect(() => {
    localStorage.setItem("pos_reservations_last_seen", new Date().toISOString());
  }, []);

  // The server has the last word on what's allowed (seat only on the day,
  // no-show only once the time has come) — say why when it refuses.
  const putReservation = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/reservations", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ variant: "destructive", title: "Couldn't update the booking", description: data.error || "Something went wrong" });
    }
    return res.ok;
  };

  const handleResvStatus = async (id: number, status: string) => {
    setUpdating(id);
    try {
      await putReservation({ id, status });
      await Promise.all([fetchReservations(), fetchTables()]);
    } finally {
      setUpdating(null);
    }
  };

  // Seating marks the table occupied (PUT /api/reservations does that).
  const handleSeatWithTable = async (tableId: number) => {
    if (!seatResv) return;
    await putReservation({ id: seatResv.id, status: "seated", table_id: tableId });
    setSeatResv(null);
    await Promise.all([fetchReservations(), fetchTables()]);
  };

  const grouped = useMemo(() => {
    const m = new Map<string, Reservation[]>();
    for (const r of reservations) {
      if (!m.has(r.reservation_date)) m.set(r.reservation_date, []);
      m.get(r.reservation_date)!.push(r);
    }
    return [...m.entries()];
  }, [reservations]);

  const pendingCount = reservations.filter(r => r.status === "pending").length;

  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* Header — title on top, Back button underneath it */}
      <div className="bg-surface border-b border-border px-3 sm:px-4 py-2.5 sm:py-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="text-xl sm:text-2xl flex-shrink-0">📅</span>
          <div className="min-w-0">
            <h1 style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-foreground font-semibold text-base sm:text-lg leading-tight tracking-[-0.02em] truncate">Reservations</h1>
            <p className="text-muted-foreground text-[10px] sm:text-xs hidden sm:block">
              {brand?.name ?? ""}{pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
            </p>
          </div>
          <button onClick={() => setAdding(true)}
            className="ml-auto px-3 sm:px-4 py-1.5 sm:py-2 bg-red-600 hover:bg-red-500 text-white text-xs sm:text-sm font-bold rounded-lg transition-colors no-select pos-btn flex-shrink-0">
            + New Reservation
          </button>
        </div>
        <Link href="/pos"
          className="mt-2 inline-block px-2.5 sm:px-4 py-1.5 sm:py-2 bg-surface-hover hover:bg-elevated text-foreground text-xs sm:text-sm font-semibold rounded-lg border border-border transition-colors">
          ← Back
        </Link>
      </div>

      <TableRequestsBanner />

      {/* Content — upcoming reservations, grouped by date, no date picker needed */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-6">
          {resvLoading ? (
            <div className="text-muted-foreground text-sm animate-pulse text-center py-10">Loading…</div>
          ) : grouped.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <span className="text-4xl">📅</span>
              <p className="text-sm">No upcoming bookings</p>
            </div>
          ) : (
            grouped.map(([date, dayResvs]) => (
              <div key={date}>
                <h2 className="text-muted-foreground text-xs font-bold uppercase tracking-widest mb-2">{dayLabel(date)}</h2>
                <div className="space-y-2">
                  {dayResvs.map(r => {
                    const cfg = resvStatusCfg[r.status] ?? resvStatusCfg.pending;
                    const busy = updating === r.id;
                    return (
                      <div key={r.id} className={`rounded-xl border p-4 ${cfg.bg}`}>
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-foreground font-bold">{r.customer_name}</span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
                                {cfg.label}
                              </span>
                              {r.source === "website" && (
                                <span className="text-[10px] text-blue-600 font-semibold">🌐 Website</span>
                              )}
                              {r.source === "pos" && (
                                <span className="text-[10px] text-muted-foreground font-semibold">📋 Staff</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className="text-red-600 font-bold text-sm">{fmtTime(r.reservation_time)}</span>
                              <span className="text-muted-foreground">·</span>
                              <span className="text-muted-foreground text-sm">👥 {r.party_size} guests</span>
                              {r.table_number && (
                                <>
                                  <span className="text-muted-foreground">·</span>
                                  <span className="text-emerald-600 text-sm font-semibold">🪑 Table {r.table_number}</span>
                                </>
                              )}
                              {r.customer_phone && (
                                <>
                                  <span className="text-muted-foreground">·</span>
                                  <a href={`tel:${r.customer_phone}`} className="text-blue-600 text-sm hover:underline">
                                    {r.customer_phone}
                                  </a>
                                </>
                              )}
                            </div>
                            {r.notes && (
                              <div className="mt-2 text-xs text-amber-700 bg-amber-100 border border-amber-300 rounded-lg px-2.5 py-1.5">
                                📝 {r.notes}
                              </div>
                            )}
                          </div>
                        </div>

                        {r.status === "waitlisted" && (
                          <div className="flex gap-2 mt-3">
                            <button onClick={() => handleResvStatus(r.id, "pending")} disabled={busy}
                              className="flex-1 h-9 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all no-select">
                              {busy ? "…" : "⬆ Promote to Reservation"}
                            </button>
                            <button onClick={() => handleResvStatus(r.id, "cancelled")} disabled={busy}
                              className="h-9 px-3 bg-surface-hover hover:bg-red-100 border border-border hover:border-red-300 text-muted-foreground hover:text-red-600 text-xs font-semibold rounded-lg transition-all disabled:opacity-50 no-select">
                              Remove
                            </button>
                          </div>
                        )}

                        {(r.status === "pending" || r.status === "confirmed") && (
                          <div className="flex gap-2 mt-3">
                            {r.status === "pending" && (
                              <button onClick={() => handleResvStatus(r.id, "confirmed")} disabled={busy}
                                className="flex-1 h-9 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all no-select">
                                {busy ? "…" : "✓ Confirm"}
                              </button>
                            )}
                            {r.status === "confirmed" && (canSeatNow(r.reservation_date) ? (
                              <button onClick={() => setSeatResv(r)} disabled={busy}
                                className="flex-1 h-9 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all no-select">
                                🪑 Seat Now — Pick Table
                              </button>
                            ) : (
                              <span className="flex-1 h-9 grid place-items-center rounded-lg border border-dashed border-border text-muted-foreground text-xs font-semibold no-select">
                                🪑 Seat on {shortDate(r.reservation_date)}
                              </span>
                            ))}
                            {canMarkNoShow(r.reservation_date, r.reservation_time) && (
                              <button onClick={() => handleResvStatus(r.id, "no_show")} disabled={busy}
                                className="h-9 px-3 bg-elevated hover:bg-elevated-hover border border-elevated text-muted-foreground text-xs font-semibold rounded-lg transition-all disabled:opacity-50 no-select">
                                No Show
                              </button>
                            )}
                            <button onClick={() => handleResvStatus(r.id, "cancelled")} disabled={busy}
                              className="h-9 px-3 bg-surface-hover hover:bg-red-100 border border-border hover:border-red-300 text-muted-foreground hover:text-red-600 text-xs font-semibold rounded-lg transition-all disabled:opacity-50 no-select">
                              Cancel
                            </button>
                          </div>
                        )}

                        {/* Seated by mistake: back to Confirmed, and the table is freed (unless it has an order) */}
                        {r.status === "seated" && (
                          <div className="flex gap-2 mt-3">
                            <button onClick={() => handleResvStatus(r.id, "confirmed")} disabled={busy}
                              className="h-9 px-3 bg-surface-hover hover:bg-elevated border border-border text-foreground text-xs font-semibold rounded-lg transition-all disabled:opacity-50 no-select">
                              {busy ? "…" : "↩ Undo seat"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Table picker modal */}
      {seatResv && (
        <TablePickerModal
          reservation={seatResv}
          tables={tables}
          onConfirm={handleSeatWithTable}
          onClose={() => setSeatResv(null)}
        />
      )}

      {/* New reservation modal */}
      {adding && (
        <NewReservationModal
          onClose={() => setAdding(false)}
          onCreated={() => { setAdding(false); fetchReservations(); }}
        />
      )}
    </div>
  );
}
