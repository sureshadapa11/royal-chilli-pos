"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import type { MenuCategory, MenuItem, CartItem, ModifierOption } from "@/lib/types";
import { isSoldOut } from "@/lib/sold-out";
import ModifierPickerModal from "./ModifierPickerModal";

type OrderType = "dine_in" | "takeaway" | "delivery" | "online";

const AVAILABILITY_KEY: Record<OrderType, keyof MenuItem> = {
  dine_in:  "available_dine_in",
  takeaway: "available_takeaway",
  delivery: "available_delivery",
  online:   "available_online",
};

interface Props {
  categories: MenuCategory[];
  items: MenuItem[];
  onAddItem: (item: CartItem) => void;
  layout?: "vertical" | "horizontal";
  orderType?: OrderType;
  /** When true, tapping any item is blocked (e.g. dine-in with no table yet) — onBlockedAdd fires instead. */
  disableAdd?: boolean;
  onBlockedAdd?: () => void;
}

const categoryIcons: Record<string, string> = {
  "Veg Starters":     "🥗",
  "Non-Veg Starters": "🍗",
  "Veg Mains":        "🍛",
  "Non-Veg Mains":    "🍖",
  "Biryanis":         "🍚",
  "Breads":           "🫓",
  "Rice & Sides":     "🍱",
  "Soups":            "🍲",
  "Desserts":         "🍮",
  "Drinks":           "🥤",
};

export default function MenuPanel({ categories, items, onAddItem, layout = "vertical", orderType, disableAdd, onBlockedAdd }: Props) {
  const [activeCat, setActiveCat] = useState<number>(0);
  const [pickerItem, setPickerItem] = useState<MenuItem | null>(null);
  // "Sold out" mode: tapping a dish marks it sold out (until 5am) or back on,
  // instead of adding it. Changes made here show at once; the rest arrive
  // with the next menu load.
  const [soldOutMode, setSoldOutMode] = useState(false);
  const [soldOutOverrides, setSoldOutOverrides] = useState<Record<number, string | null>>({});
  const soldOut = (item: MenuItem) =>
    isSoldOut({ sold_out_until: item.id in soldOutOverrides ? soldOutOverrides[item.id] : item.sold_out_until });

  const toggleSoldOut = async (item: MenuItem) => {
    const next = !soldOut(item);
    const res = await fetch(`/api/menu-items/${item.id}/sold-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sold_out: next }),
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setSoldOutOverrides((o) => ({ ...o, [item.id]: data.item.sold_out_until }));
    }
  };

  useEffect(() => {
    if (categories.length > 0 && activeCat === 0) {
      setActiveCat(categories[0].id);
    }
  }, [categories]);

  const availKey = orderType ? AVAILABILITY_KEY[orderType] : null;
  const visibleCategories = availKey
    ? categories.filter(c => items.some(i => i.category_id === c.id && i[availKey] !== false))
    : categories;
  const filteredItems = items.filter((i) => {
    if (i.category_id !== activeCat) return false;
    if (availKey && i[availKey] === false) return false;
    return true;
  });
  const activeCategory = visibleCategories.find(c => c.id === activeCat);

  // Delivery orders (e.g. phone orders) pay the delivery price, the same as
  // website delivery; everything else pays the till price. Switching order
  // type empties the basket, so items are always added at the right price.
  const priceOf = (item: MenuItem) =>
    orderType === "delivery" && item.online_price != null ? Number(item.online_price) : Number(item.price);

  const handleAdd = (item: MenuItem) => {
    if (soldOutMode) {
      toggleSoldOut(item);
      return;
    }
    if (soldOut(item)) return;
    if (disableAdd) {
      onBlockedAdd?.();
      return;
    }
    if (item.modifierGroups && item.modifierGroups.length > 0) {
      setPickerItem(item);
      return;
    }
    onAddItem({
      menu_item_id: item.id,
      item_name: item.name,
      item_price: priceOf(item),
      quantity: 1,
      is_veg: item.is_veg,
    });
  };

  const handleConfirmModifiers = (selected: ModifierOption[], unitPrice: number, notes: string) => {
    if (!pickerItem) return;
    onAddItem({
      menu_item_id: pickerItem.id,
      item_name: pickerItem.name,
      item_price: unitPrice,
      quantity: 1,
      is_veg: pickerItem.is_veg,
      selected_modifiers: selected,
      ...(notes ? { notes } : {}),
    });
    setPickerItem(null);
  };

  const picker = pickerItem && (
    <ModifierPickerModal item={{ ...pickerItem, price: priceOf(pickerItem) }} onClose={() => setPickerItem(null)} onConfirm={handleConfirmModifiers} />
  );

  // ── Horizontal layout (mobile/tablet) ─────────────────────────────────
  if (layout === "horizontal") {
    return (
      <>
      {picker}
      <div className="flex flex-col h-full gap-2">

        {/* Categories — fixed to ~3 rows tall, scrolls for the rest */}
        <div className="flex-shrink-0 max-h-[132px] overflow-y-auto overscroll-contain [-ms-overflow-style:none] [scrollbar-width:thin]">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1.5">
            {visibleCategories.map((cat) => {
              const isActive = activeCat === cat.id;
              const icon = categoryIcons[cat.name] ?? "🍽️";
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCat(cat.id)}
                  className={cn(
                    "pos-btn no-select flex items-center justify-center gap-1.5",
                    "rounded-xl h-10 px-2 transition-all border w-full",
                    isActive
                      ? "border-transparent shadow-lg"
                      : "bg-surface-hover border-border hover:bg-elevated"
                  )}
                  style={isActive ? {
                    backgroundColor: cat.color + "1a",
                    borderColor: cat.color,
                    boxShadow: `0 0 10px ${cat.color}20`,
                  } : undefined}
                >
                  <span className="text-base leading-none flex-shrink-0">{icon}</span>
                  <span
                    className={cn("text-[11px] font-bold leading-tight truncate", isActive ? "" : "text-muted-foreground")}
                    style={isActive ? { color: cat.color } : undefined}
                  >
                    {cat.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Active category label */}
        {activeCategory && (
          <div className="flex items-center gap-2 flex-shrink-0 mb-1">
            <span className="text-base">{categoryIcons[activeCategory.name] ?? "🍽️"}</span>
            <span className="font-bold text-sm" style={{ color: activeCategory.color }}>{activeCategory.name}</span>
            <span className="text-xs text-muted-foreground">{filteredItems.length} items</span>
            <button
              onClick={() => setSoldOutMode((m) => !m)}
              className={`ml-auto rounded-lg px-2.5 py-1 text-[11px] font-bold ${soldOutMode ? "bg-amber-500 text-white" : "bg-surface-hover text-muted-foreground border border-border"}`}
              title="Tap dishes to mark them sold out (until 5am) or back on"
            >
              {soldOutMode ? "✓ Done" : "🚫 Sold out"}
            </button>
          </div>
        )}

        {/* Items grid */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {filteredItems.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              No items in this category
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 pb-2">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleAdd(item)}
                  className={`pos-btn no-select group bg-surface hover:bg-surface-hover active:scale-95 border border-border hover:border-elevated-hover rounded-xl p-3 text-left transition-all flex flex-col gap-1.5 min-h-[80px] ${soldOut(item) ? "opacity-40" : ""} ${soldOutMode ? "ring-2 ring-amber-400" : ""}`}
                >
                  {soldOut(item) && <span className="text-[10px] font-black text-red-600">SOLD OUT</span>}
                  <div className="flex items-start justify-between gap-1.5 flex-1">
                    <span className="text-foreground text-[13px] font-semibold leading-snug flex-1">
                      {item.name}
                    </span>
                    <span className={item.is_veg ? "veg-dot mt-0.5 flex-shrink-0" : "non-veg-dot mt-0.5 flex-shrink-0"} />
                  </div>
                  <div
                    className="text-sm font-black mt-auto"
                    style={{ color: activeCategory?.color ?? "#dc2626" }}
                  >
                    {formatCurrency(priceOf(item))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      </>
    );
  }

  // ── Vertical layout (desktop) ──────────────────────────────────────────
  return (
    <>
    {picker}
    <div className="flex h-full gap-3">

      {/* Category Column */}
      <div className="w-[110px] flex-shrink-0 flex flex-col gap-1.5">
        {categories.map((cat) => {
          const isActive = activeCat === cat.id;
          const icon = categoryIcons[cat.name] ?? "🍽️";
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCat(cat.id)}
              className={cn(
                "pos-btn no-select w-full flex items-center gap-2",
                "rounded-xl h-[72px] px-2.5 transition-all duration-150 border text-left",
                isActive
                  ? "border-transparent shadow-lg"
                  : "bg-surface-hover border-border hover:bg-elevated hover:border-elevated-hover"
              )}
              style={isActive ? {
                backgroundColor: cat.color + "1a",
                borderColor: cat.color,
                boxShadow: `0 0 14px ${cat.color}25`,
              } : undefined}
            >
              <span className="text-2xl leading-none flex-shrink-0">{icon}</span>
              <span
                className={cn("text-[11px] font-bold leading-tight", isActive ? "" : "text-muted-foreground")}
                style={isActive ? { color: cat.color } : undefined}
              >
                {cat.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* Items Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {activeCategory && (
          <div className="flex items-center gap-2 mb-3 flex-shrink-0">
            <span className="text-lg">{categoryIcons[activeCategory.name] ?? "🍽️"}</span>
            <h2 className="text-base font-bold" style={{ color: activeCategory.color }}>
              {activeCategory.name}
            </h2>
            <span className="text-xs text-muted-foreground ml-1">{filteredItems.length} items</span>
            <button
              onClick={() => setSoldOutMode((m) => !m)}
              className={`ml-auto rounded-lg px-2.5 py-1 text-[11px] font-bold ${soldOutMode ? "bg-amber-500 text-white" : "bg-surface-hover text-muted-foreground border border-border"}`}
              title="Tap dishes to mark them sold out (until 5am) or back on"
            >
              {soldOutMode ? "✓ Done" : "🚫 Sold out"}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {filteredItems.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              No items in this category
            </div>
          ) : (
            <div className="grid grid-cols-3 xl:grid-cols-4 gap-2 pb-2">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleAdd(item)}
                  className={`pos-btn no-select group bg-surface hover:bg-surface-hover active:scale-95 border border-border hover:border-elevated-hover rounded-xl p-3 text-left transition-all flex flex-col gap-1.5 min-h-[88px] ${soldOut(item) ? "opacity-40" : ""} ${soldOutMode ? "ring-2 ring-amber-400" : ""}`}
                >
                  {soldOut(item) && <span className="text-[10px] font-black text-red-600">SOLD OUT</span>}
                  <div className="flex items-start justify-between gap-1.5 flex-1">
                    <span className="text-foreground text-[13px] font-semibold leading-snug flex-1">
                      {item.name}
                    </span>
                    <span className={item.is_veg ? "veg-dot mt-0.5 flex-shrink-0" : "non-veg-dot mt-0.5 flex-shrink-0"} />
                  </div>
                  <div
                    className="text-sm font-black mt-auto"
                    style={{ color: activeCategory?.color ?? "#dc2626" }}
                  >
                    {formatCurrency(priceOf(item))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
