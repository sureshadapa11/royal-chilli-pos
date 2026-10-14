"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/utils";
import type { MenuItem } from "@/lib/menu";

export default function ModifierPickerModal({
  item,
  onClose,
  onConfirm,
  withQuantityAndNotes = false,
}: {
  item: MenuItem;
  onClose: () => void;
  onConfirm: (selectedOptionIds: number[], unitPrice: number, quantity: number, notes: string) => void;
  withQuantityAndNotes?: boolean;
}) {
  const [selectedByGroup, setSelectedByGroup] = useState<Record<number, number[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);

  function toggle(groupId: number, optionId: number, single: boolean, max: number | null) {
    setSelectedByGroup((prev) => {
      const current = prev[groupId] || [];
      if (single) {
        return { ...prev, [groupId]: current.includes(optionId) ? [] : [optionId] };
      }
      if (current.includes(optionId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== optionId) };
      }
      if (max !== null && current.length >= max) return prev; // at the cap, ignore
      return { ...prev, [groupId]: [...current, optionId] };
    });
  }

  const allSelectedIds = Object.values(selectedByGroup).flat();
  const priceDelta = item.modifierGroups
    .flatMap((g) => g.options)
    .filter((o) => allSelectedIds.includes(o.id))
    .reduce((s, o) => s + o.price_delta, 0);
  const unitPrice = Math.round((item.price + priceDelta) * 100) / 100;

  const unmetRequired = item.modifierGroups.filter((g) => g.required && (selectedByGroup[g.id] || []).length === 0);
  const canConfirm = unmetRequired.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-5">
        <h2 className="font-[family-name:var(--font-playfair)] text-xl">{item.name}</h2>
        {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}

        <div className="mt-4 space-y-4">
          {item.modifierGroups.map((group) => (
            <div key={group.id}>
              <p className="text-sm font-semibold">
                {group.name} {group.required && <span className="text-primary">*</span>}
                {group.selection_type === "multiple" && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    (choose {group.max_select ? `up to ${group.max_select}` : "any"})
                  </span>
                )}
              </p>
              <div className="mt-2 space-y-1.5">
                {group.options.map((opt) => {
                  const checked = (selectedByGroup[group.id] || []).includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggle(group.id, opt.id, group.selection_type === "single", group.max_select)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                        checked ? "border-primary bg-primary/10" : "border-border"
                      }`}
                    >
                      <span>{opt.name}</span>
                      <span className="text-muted-foreground">{opt.price_delta > 0 ? `+${formatCurrency(opt.price_delta)}` : opt.price_delta < 0 ? formatCurrency(opt.price_delta) : ""}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {withQuantityAndNotes && (
          <>
            {/* Hidden until tapped (agreed 2026-10-14). */}
            <div className="mt-4">
              {!showNotes && !notes ? (
                <button type="button" onClick={() => setShowNotes(true)} className="text-sm text-primary underline">+ Add note</button>
              ) : (<>
                <p className="text-sm font-semibold">Note</p>
                <textarea
                  autoFocus
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. no onion, extra gravy"
                  rows={2}
                  className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </>)}
            </div>
            <div className="mt-4">
              <p className="text-sm font-semibold">Quantity</p>
              <div className="mt-2 inline-flex items-center gap-3 rounded-lg border border-border px-2 py-1">
                <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity" className="h-8 w-8 text-lg leading-none">−</button>
                <span className="w-4 text-center">{quantity}</span>
                <button onClick={() => setQuantity((q) => q + 1)} aria-label="Increase quantity" className="h-8 w-8 text-lg leading-none">+</button>
              </div>
            </div>
          </>
        )}

        <div className="mt-5 flex gap-3">
          <button onClick={onClose} className="flex-1 border border-border py-2.5 text-xs uppercase tracking-[0.1em]">Cancel</button>
          <button
            onClick={() => canConfirm && onConfirm(allSelectedIds, unitPrice, quantity, notes.trim())}
            disabled={!canConfirm}
            className="flex-1 bg-primary py-2.5 text-xs uppercase tracking-[0.15em] text-primary-foreground disabled:opacity-50"
          >
            Add · {formatCurrency(unitPrice * (withQuantityAndNotes ? quantity : 1))}
          </button>
        </div>
      </div>
    </div>
  );
}
