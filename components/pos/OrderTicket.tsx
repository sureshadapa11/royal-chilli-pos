"use client";

import { ALLERGENS } from "@/lib/allergens";
import { useState } from "react";
import Image from "next/image";
import { formatCurrency } from "@/lib/utils";
import type { CartItem } from "@/lib/types";

interface Props {
  items: CartItem[];
  onUpdateQty: (idx: number, qty: number) => void;
  onRemove: (idx: number) => void;
  onVoid: (idx: number, newQty: number) => void;
  onNote?: (idx: number, note: string) => void;
  allergy?: TillAllergy;
  onAllergy?: (v: TillAllergy) => void;
}

function VoidPanel({ item, idx, onVoid, onClose }: {
  item: CartItem;
  idx: number;
  onVoid: (idx: number, qty: number) => void;
  onClose: () => void;
}) {
  // qty=1 items default to full void (keep=0); qty>1 starts at original so cashier must reduce
  const [qty, setQty] = useState(item.quantity === 1 ? 0 : item.quantity);

  const confirm = () => {
    onVoid(idx, qty);
    onClose();
  };

  return (
    <div className="mt-1.5 bg-red-50 border border-red-200 rounded-xl p-3 space-y-2.5">
      <p className="text-red-700 text-xs font-bold">Void: {item.item_name}</p>

      {item.quantity > 1 && (
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs">Qty to keep:</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setQty(q => Math.max(0, q - 1))}
              className="w-7 h-7 rounded-lg bg-elevated hover:bg-red-100 hover:text-red-700 text-foreground flex items-center justify-center font-bold no-select">
              −
            </button>
            <span className="text-foreground font-black text-sm w-5 text-center">{qty}</span>
            <button onClick={() => setQty(q => Math.min(item.quantity, q + 1))}
              className="w-7 h-7 rounded-lg bg-elevated hover:bg-elevated-hover text-foreground flex items-center justify-center font-bold no-select">
              +
            </button>
          </div>
          <span className="text-muted-foreground text-xs">of {item.quantity}</span>
        </div>
      )}

      {qty === 0
        ? <p className="text-red-600 text-xs">Full void — item removed from bill</p>
        : qty < item.quantity
        ? <p className="text-amber-600 text-xs">Reducing from {item.quantity} → {qty}</p>
        : <p className="text-muted-foreground text-xs">Adjust quantity above or confirm void</p>
      }

      <div className="flex gap-2">
        <button onClick={onClose}
          className="flex-1 py-1.5 rounded-lg bg-elevated text-foreground text-xs font-semibold hover:bg-elevated-hover no-select">
          Cancel
        </button>
        <button onClick={confirm}
          disabled={qty === item.quantity}
          className="flex-1 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-elevated disabled:text-muted-foreground text-white text-xs font-bold no-select">
          {qty === 0 ? "Void Item" : "Reduce Qty"}
        </button>
      </div>
    </div>
  );
}

// "+ Add note" under a line not yet sent (agreed 2026-10-14): hidden until tapped.
function TicketNote({ note, onSave }: { note?: string; onSave: (n: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note ?? "");
  if (!open) {
    return note
      ? <button onClick={() => { setText(note); setOpen(true); }} className="block text-left text-[11px] font-semibold text-amber-700">📝 {note} <span className="underline">edit</span></button>
      : <button onClick={() => { setText(""); setOpen(true); }} className="block text-[11px] font-semibold text-red-600 underline">+ Add note</button>;
  }
  const save = () => { onSave(text.trim().slice(0, 200)); setOpen(false); };
  return (
    <div className="mt-1 flex gap-1">
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} maxLength={200}
        placeholder="e.g. no onion" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs" />
      <button onClick={save} className="h-8 rounded-md bg-red-600 px-2.5 text-xs font-semibold text-white">Save</button>
    </div>
  );
}

export type TillAllergy = { allergens: string[]; notes: string };

// The order's allergy (agreed 2026-10-14): tick + note, shown on the kitchen ticket.
function AllergyBar({ value, onChange, locked }: { value: TillAllergy; onChange: (v: TillAllergy) => void; locked: boolean }) {
  const [open, setOpen] = useState(false);
  const has = value.allergens.length > 0 || value.notes.trim().length > 0;
  const text = [value.allergens.map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join(", "), value.notes.trim()].filter(Boolean).join(" — ");
  return (
    <div className="mb-1.5">
      <button onClick={() => !locked && setOpen(!open)}
        className={`w-full rounded-xl px-3 py-2 text-left text-xs font-bold ${has ? "border-2 border-red-500 bg-red-50 text-red-800" : "border border-dashed border-border text-muted-foreground"}`}>
        {has ? `⚠️ ALLERGY: ${text}` : "⚠️ Allergy? Tap to add"}{!locked && has ? " · edit" : ""}
      </button>
      {open && (
        <div className="mt-1 rounded-xl border border-border bg-surface p-2.5">
          <div className="flex flex-wrap gap-1">
            {ALLERGENS.map((a) => {
              const on = value.allergens.includes(a);
              return (
                <button key={a} onClick={() => onChange({ ...value, allergens: on ? value.allergens.filter((x) => x !== a) : [...value.allergens, a] })}
                  className={`rounded-full border px-2 py-1 text-[11px] capitalize ${on ? "border-red-500 bg-red-100 font-bold text-red-800" : "border-border text-muted-foreground"}`}>{a}</button>
              );
            })}
          </div>
          <input value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} maxLength={300} placeholder="Details, e.g. severe, no nuts at all"
            className="mt-2 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs" />
          <button onClick={() => setOpen(false)} className="mt-2 w-full rounded-lg bg-red-600 py-1.5 text-xs font-semibold text-white">Done</button>
        </div>
      )}
    </div>
  );
}

export default function OrderTicket({ items, onUpdateQty, onRemove, onVoid, onNote, allergy, onAllergy }: Props) {
  const [voidOpenIdx, setVoidOpenIdx] = useState<number | null>(null);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Image src="/cart-empty.png" alt="" width={220} height={183} className="w-[110px] h-auto opacity-90" priority />
        <p className="text-sm font-medium">Order is empty</p>
        <p className="text-xs">Tap items from the menu to add them</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto space-y-1 pr-0.5">
      {allergy && onAllergy && <AllergyBar value={allergy} onChange={onAllergy} locked={false} />}
      {items.map((item, idx) => (
        <div key={idx}>
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 transition-colors ${
            item.voided
              ? "bg-red-50 opacity-70"
              : item.sent
              ? "bg-surface-hover"
              : "bg-surface hover:bg-surface-hover"
          }`}>

            {/* Veg dot + name */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={item.is_veg ? "veg-dot flex-shrink-0" : "non-veg-dot flex-shrink-0"} />
                <span className={`text-sm font-semibold truncate ${item.voided ? "line-through text-muted-foreground" : item.sent ? "text-muted-foreground" : "text-foreground"}`}>
                  {item.item_name}
                </span>
                {item.voided && (
                  <span className="text-[9px] font-black text-red-700 bg-red-100 px-1.5 py-0.5 rounded flex-shrink-0">VOIDED</span>
                )}
                {item.sent && !item.voided && (
                  <span className="text-[9px] font-black text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">IN KITCHEN</span>
                )}
              </div>
              {item.selected_modifiers && item.selected_modifiers.length > 0 && (
                <div className="text-muted-foreground text-[11px] truncate">
                  {item.selected_modifiers.map((m) => m.name).join(", ")}
                </div>
              )}
              <span className="text-muted-foreground text-xs">{formatCurrency(item.item_price)} ea</span>
              {!item.sent && !item.voided && onNote
                ? <TicketNote note={item.notes} onSave={(n) => onNote(idx, n)} />
                : item.notes ? <div className="text-[11px] font-semibold text-amber-700">📝 {item.notes}</div> : null}
            </div>

            {/* Qty */}
            {item.voided ? (
              <span className="text-muted-foreground line-through text-sm w-5 text-center flex-shrink-0">{item.quantity}</span>
            ) : item.sent ? (
              <span className="text-muted-foreground font-black text-sm w-5 text-center flex-shrink-0">{item.quantity}</span>
            ) : (
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => onUpdateQty(idx, item.quantity - 1)}
                  className="w-7 h-7 rounded-lg bg-elevated hover:bg-red-100 hover:text-red-700 text-foreground flex items-center justify-center font-bold no-select pos-btn transition-colors">
                  −
                </button>
                <span className="text-foreground font-black text-sm w-5 text-center">{item.quantity}</span>
                <button onClick={() => onUpdateQty(idx, item.quantity + 1)}
                  className="w-7 h-7 rounded-lg bg-elevated hover:bg-emerald-100 hover:text-emerald-700 text-foreground flex items-center justify-center font-bold no-select pos-btn transition-colors">
                  +
                </button>
              </div>
            )}

            {/* Line total / action */}
            <div className="text-right min-w-[52px] flex-shrink-0">
              <div className={`text-sm font-bold ${item.voided ? "line-through text-muted-foreground" : item.sent ? "text-muted-foreground" : "text-foreground"}`}>
                {formatCurrency(item.item_price * item.quantity)}
              </div>
              {!item.voided && !item.sent && (
                <button onClick={() => onRemove(idx)} className="text-muted-foreground hover:text-red-600 text-[10px] no-select transition-colors">
                  remove
                </button>
              )}
              {item.sent && !item.voided && (
                <button
                  onClick={() => setVoidOpenIdx(voidOpenIdx === idx ? null : idx)}
                  className="text-red-600 hover:text-red-700 text-[10px] font-semibold no-select transition-colors">
                  void
                </button>
              )}
            </div>

          </div>

          {/* Void panel */}
          {voidOpenIdx === idx && !item.voided && (
            <VoidPanel
              item={item}
              idx={idx}
              onVoid={onVoid}
              onClose={() => setVoidOpenIdx(null)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
