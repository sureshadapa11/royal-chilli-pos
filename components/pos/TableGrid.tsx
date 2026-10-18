"use client";

import { useState } from "react";
import { cn, TABLE_ATTENTION_MINUTES, minutesSince, tableElapsedLabel } from "@/lib/utils";
import type { RestaurantTable } from "@/lib/types";
import { joinLabel } from "@/lib/floor-plan";
import { classicTillLayout } from "@/lib/till-table-layout";

interface Props {
  tables: RestaurantTable[];
  selectedTable: number | null;
  onSelect: (table: RestaurantTable) => void;
  // Manual status flip with no order attached — for a table that's been
  // physically pushed together with another for a big party, but isn't
  // carrying the order itself. Keeps it out of the "tap to select" action.
  onStatusChange: (tableId: number, status: "available" | "occupied" | "reserved") => void;
  // Reservations aren't linked to a specific table until they're seated, so
  // there's no individual table to flag "Reserved" ahead of time — this is a
  // plain count of today's bookings coming up soon instead (see /api/tables).
  upcomingReservationCount: number;
}

export default function TableGrid({ tables, selectedTable, onSelect, onStatusChange, upcomingReservationCount }: Props) {
  const [menuFor, setMenuFor] = useState<number | null>(null);
  // Laid out like the original till (lib/till-table-layout.ts): by number,
  // every table the same card, a 3 × 3 block then rows of 4. Joined tables
  // are one long table, "T1 + T2": the lead's card carries the order, and the
  // other tables keep their spot as a faded "with T1" card that opens the lead.
  const byId = new Map(tables.map(t => [t.id, t]));
  const leadOf = (t: RestaurantTable) => (t.joined_to != null && byId.has(t.joined_to) ? byId.get(t.joined_to)! : t);
  const membersOf = (lead: RestaurantTable) => tables.filter(t => t.id === lead.id || leadOf(t).id === lead.id);
  const leads = tables.filter(t => leadOf(t).id === t.id);
  const { block, rest } = classicTillLayout(tables);

  const stats = {
    free:     leads.filter(t => t.status === "available").length,
    occupied: leads.filter(t => t.status === "occupied").length,
    reserved: upcomingReservationCount,
  };

  const card = (t: RestaurantTable, firstRow: boolean) => {
    const lead = leadOf(t);
    if (lead.id !== t.id) {
      // part of a joined table: its own spot, opens the lead table
      const isSelected = selectedTable === lead.id;
      return (
        <div
          key={t.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(lead)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(lead); }}
          className={cn(
            "relative flex flex-col items-center justify-center rounded-xl border border-dashed overflow-hidden cursor-pointer",
            "h-[72px] transition-all duration-150 no-select pos-btn opacity-60",
            isSelected ? "border-blue-400 bg-blue-50" : "border-border bg-surface hover:bg-surface-hover"
          )}
        >
          <span className="text-[15px] font-black leading-none tracking-tight text-foreground/70">{t.table_number}</span>
          <span className="text-[9px] font-semibold mt-0.5 text-muted-foreground">with {lead.table_number}</span>
        </div>
      );
    }

    const members = membersOf(t);
    const joined = members.length > 1;
    const label = joined ? joinLabel(members) : t.table_number;
    const groupName = joined ? t.group_name?.trim() || null : null;
    const capacity = members.reduce((s, m) => s + m.capacity, 0);
    const isSelected = selectedTable === t.id;
    const status = t.status as "available" | "occupied" | "reserved";
    const elapsedMins = t.occupied_since ? minutesSince(t.occupied_since) : null;
    const needsAttention = status === "occupied" && elapsedMins !== null && elapsedMins >= TABLE_ATTENTION_MINUTES;

    const statusCfg = {
      available: {
        card:   "bg-surface border-border hover:border-emerald-500/50 hover:bg-surface-hover",
        stripe: "bg-emerald-500",
        num:    "text-foreground",
        label:  "text-emerald-600",
        text:   "Free",
      },
      occupied: {
        card:   "bg-red-50 border-red-200 hover:border-red-400",
        stripe: "bg-red-500",
        num:    "text-red-700",
        label:  "text-red-600",
        text:   "Busy",
      },
      reserved: {
        card:   "bg-amber-50 border-amber-200 hover:border-amber-400",
        stripe: "bg-amber-500",
        num:    "text-amber-700",
        label:  "text-amber-600",
        text:   "Rsv",
      },
      attention: {
        card:   "bg-orange-100 border-orange-400 hover:border-orange-500",
        stripe: "bg-orange-600",
        num:    "text-orange-800",
        label:  "text-orange-700",
        text:   "Attention",
      },
    }[needsAttention ? "attention" : status];

    return (
      <div
        key={t.id}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(t)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(t); }}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-xl border cursor-pointer",
          "h-[72px] transition-all duration-150 no-select pos-btn",
          menuFor === t.id ? "z-50" : "",
          isSelected
            ? "border-blue-400 bg-blue-50 ring-2 ring-blue-400/40 ring-offset-1 ring-offset-background"
            : statusCfg.card
        )}
      >
        {/* Top colour stripe */}
        <div className={cn(
          "absolute top-0 left-0 right-0 h-[3px] rounded-t-xl",
          isSelected ? "bg-blue-400" : statusCfg.stripe
        )} />

        {/* Pulsing dot for occupied / attention */}
        {status === "occupied" && !isSelected && (
          <div className="absolute top-2 right-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-60", needsAttention ? "bg-orange-400" : "bg-red-400")} />
              <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", needsAttention ? "bg-orange-600" : "bg-red-500")} />
            </span>
          </div>
        )}
        {needsAttention && !isSelected && (
          <div className="absolute top-1.5 left-1.5 text-[10px]">⚠️</div>
        )}
        {isSelected && (
          <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-blue-400" />
        )}

        {/* Table number ("T1 + T2" when joined) */}
        <span className={cn(
          "max-w-full truncate px-1 text-[17px] font-black leading-none tracking-tight",
          joined && "text-[14px]",
          isSelected ? "text-blue-700" : statusCfg.num
        )}>
          {label}
        </span>
        {groupName && (
          <span className="mt-0.5 max-w-full truncate px-1 text-[9px] font-semibold text-foreground/70">{groupName}</span>
        )}

        {/* Status label */}
        <span className={cn(
          "text-[9px] font-bold mt-0.5 uppercase tracking-wide",
          isSelected ? "text-blue-600" : statusCfg.label
        )}>
          {isSelected ? "Selected" : statusCfg.text}
        </span>

        {/* Capacity / elapsed time */}
        <span className={cn("text-[9px] leading-none mt-0.5", needsAttention ? "text-orange-700 font-bold" : "text-muted-foreground")}>
          {elapsedMins !== null ? `${capacity}p · ${tableElapsedLabel(elapsedMins)}` : `${capacity}p`}
        </span>

        {/* Manual status override — flag a table Occupied/Reserved with no
            order attached (a table pushed together with another for a big
            party, not carrying the order itself), or clear it back to
            Available. Stops the tap propagating to onSelect above. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === t.id ? null : t.id); }}
          aria-label={`Change status for table ${label}`}
          className="absolute bottom-0.5 right-0.5 grid h-4 w-4 place-items-center rounded text-[10px] leading-none text-muted-foreground/60 hover:text-foreground hover:bg-black/5"
        >
          ⋮
        </button>
        {menuFor === t.id && (
          <>
            <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setMenuFor(null); }} />
            <div
              onClick={(e) => e.stopPropagation()}
              className={cn("absolute right-0 z-50 w-32 rounded-lg border border-border bg-surface shadow-lg py-1", firstRow ? "top-full mt-1" : "bottom-full mb-1")}
            >
              {([
                { value: "available", label: "Mark Available" },
                { value: "occupied", label: "Mark Occupied" },
                { value: "reserved", label: "Mark Reserved" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={status === opt.value}
                  onClick={() => { onStatusChange(t.id, opt.value); setMenuFor(null); }}
                  className="block w-full px-2.5 py-1.5 text-left text-[11px] text-foreground hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Free",     count: stats.free,     color: "text-emerald-600", bg: "bg-emerald-500/10 border-emerald-500/30" },
          { label: "Occupied", count: stats.occupied, color: "text-red-600",     bg: "bg-red-500/10 border-red-500/30" },
          { label: "Upcoming", count: stats.reserved, color: "text-amber-600",   bg: "bg-amber-500/10 border-amber-500/30", title: "Reservations booked for the next 90 minutes — no specific table yet, that's assigned when they're seated" },
        ].map(s => (
          <div key={s.label} title={"title" in s ? s.title : undefined} className={`rounded-xl border px-3 py-2 text-center ${s.bg}`}>
            <div className={`text-xl font-black ${s.color}`}>{s.count}</div>
            <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tables: the 3 × 3 block, then rows of 4 */}
      {block.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {block.map((t, i) => card(t, i < 3))}
        </div>
      )}
      {rest.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {rest.map((t) => card(t, false))}
        </div>
      )}
    </div>
  );
}
