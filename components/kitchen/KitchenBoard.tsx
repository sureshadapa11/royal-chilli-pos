"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import type { Order, OrderItem } from "@/lib/types";
import { boxesPerScreen, boxWidth, BOX_GAP, screenCount, screenOf, tabLabel } from "@/lib/kitchen-pages";
import TableRequestsBanner from "@/components/pos/TableRequestsBanner";
import PrintButton from "@/components/pos/PrintButton";

// Kitchen Display. Each table or order is one box, side by side, oldest on
// the left, only as tall as its items need — a long one scrolls inside its
// own box. A table's later rounds (each till "Send to Kitchen") join its box
// as Round 2, Round 3… with their own timers. How many boxes fit per screen
// depends on the device (lib/kitchen-pages.ts). Above them, one tab per box
// (T7, Online 23, Collection 41) coloured by its timer: the ones on screen are
// outlined, and tapping any tab jumps straight to it. A new order that lands
// off screen pulses 🔔 on its tab until someone looks.

interface OrderWithItems extends Order {
  items: OrderItem[];
}

const getAgeMinutes = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 60000);

function timerClass(minutes: number): string {
  if (minutes >= 20) return "bg-red-600 text-white";
  if (minutes >= 10) return "bg-orange-100 text-orange-700";
  return "bg-yellow-100 text-yellow-800";
}

function boxClass(group: OrderWithItems[]): string {
  const first = group[0];
  if (first.just_cancelled) return "border-red-600 bg-red-50 animate-pulse";
  const age = getAgeMinutes(first.created_at);
  if (age >= 20) return "border-red-600";
  if (age >= 10) return "border-red-400";
  if (group.some((o) => (o.round ?? 1) > 1)) return "border-orange-500";
  return "border-yellow-500 kitchen-new";
}

function headClass(group: OrderWithItems[]): string {
  const first = group[0];
  if (first.just_cancelled) return "bg-red-200";
  const age = getAgeMinutes(first.created_at);
  if (age >= 10) return "bg-red-50";
  if (group.some((o) => (o.round ?? 1) > 1)) return "bg-orange-50";
  return "bg-yellow-50";
}

function orderHasChanges(order: OrderWithItems): boolean {
  return order.items.some((i) => i.status === "cancelled" || (i.original_quantity != null && i.quantity < i.original_quantity));
}

// One box per table (all its rounds) or per takeaway/delivery order, in the
// order its first ticket arrived. Cancelled alerts stand alone, first.
function groupByTable(list: OrderWithItems[]): OrderWithItems[][] {
  const groups: OrderWithItems[][] = [];
  const indexByTable = new Map<number, number>();
  for (const o of list) {
    if (o.table_id != null && !o.just_cancelled) {
      const idx = indexByTable.get(o.table_id);
      if (idx !== undefined) {
        groups[idx].push(o);
        continue;
      }
      indexByTable.set(o.table_id, groups.length);
    }
    groups.push([o]);
  }
  return groups;
}

function boxTitle(order: OrderWithItems): string {
  if (order.order_type === "dine_in") return order.table_number ? `Table ${order.table_number}` : "Dine in";
  const who = order.customer_name || order.order_number;
  return order.order_type === "delivery" ? `🛵 ${who}` : `🥡 ${who}`;
}

function boxSubtitle(group: OrderWithItems[]): string {
  const first = group[0];
  const parts: string[] = [];
  if (first.order_type === "dine_in") parts.push("Dine in");
  else parts.push(`${first.order_type === "delivery" ? "Delivery" : "Collection"} · ${first.order_number}`);
  if (first.order_type !== "dine_in" && !first.staff_id) parts.push("Online");
  if (first.staff_name) parts.push(first.staff_name);
  if (group.length > 1) parts.push(`${group.length} rounds`);
  return parts.join(" · ");
}

// One dish — tap to mark it done (tap again to undo) while its round is
// still cooking. The last dish of a round done completes that round.
function ItemRow({
  item,
  orderId,
  canBump,
  onBumpItem,
}: {
  item: OrderItem;
  orderId: number;
  canBump: boolean;
  onBumpItem: (orderId: number, itemId: number, status: "ready" | "pending") => void;
}) {
  const [flash, setFlash] = useState(false);
  const cancelled = item.status === "cancelled";
  const bumped = item.status === "ready";
  const qtyReduced = !cancelled && item.original_quantity != null && item.quantity < item.original_quantity;

  const handleClick = () => {
    if (!canBump || cancelled) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 400);
    onBumpItem(orderId, item.id, bumped ? "pending" : "ready");
  };

  return (
    <div
      onClick={handleClick}
      className={`flex items-start gap-2.5 rounded-lg px-1.5 -mx-1.5 py-1.5 border-b border-border/60 last:border-b-0 ${cancelled ? "opacity-50" : ""} ${flash ? "bump-flash" : ""} ${canBump && !cancelled ? "cursor-pointer active:scale-[0.98] transition-transform" : ""}`}
    >
      <span className={`flex-shrink-0 text-sm font-black w-7 h-7 rounded-full flex items-center justify-center ${
        cancelled ? "bg-red-100 text-red-600 line-through" : bumped ? "bg-green-600 text-white" : "bg-elevated text-foreground"
      }`}>
        {bumped && !cancelled ? "✓" : item.quantity}
      </span>
      <div className="flex-1 min-w-0">
        <div className={`text-base lg:text-lg font-semibold leading-snug ${cancelled ? "line-through text-red-600" : bumped ? "line-through text-green-700" : "text-foreground"}`}>
          {item.item_name}
        </div>
        {item.modifiers && item.modifiers.length > 0 && <div className="text-red-600 text-xs font-semibold">{item.modifiers.join(", ")}</div>}
        {cancelled && <span className="text-[10px] font-black text-red-600 bg-red-100 px-1.5 py-0.5 rounded">✕ VOIDED BY CASHIER</span>}
        {qtyReduced && (
          <span className="text-[10px] font-black text-yellow-700 bg-yellow-100 px-1.5 py-0.5 rounded">
            ↓ QTY: {item.original_quantity} → {item.quantity}
          </span>
        )}
        {item.notes && <div className="text-amber-700 text-xs font-semibold italic mt-0.5">⚠ {item.notes}</div>}
      </div>
    </div>
  );
}

// One round inside a box: its label (Round 2 · ADDED · ⏱ timer · 🖨) when
// the table has more than one, then its dishes and note.
function RoundSection({
  order,
  showLabel,
  onBumpItem,
}: {
  order: OrderWithItems;
  showLabel: boolean;
  onBumpItem: (orderId: number, itemId: number, status: "ready" | "pending") => void;
}) {
  const canBump = order.status === "sent_to_kitchen" && !order.just_cancelled;
  const age = getAgeMinutes(order.created_at);
  const round = order.round ?? 1;
  return (
    <div className="pt-2 [&+&]:mt-2 [&+&]:border-t-2 [&+&]:border-dashed [&+&]:border-border">
      {showLabel && (
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="flex items-center gap-1.5 text-[11px] font-black tracking-wide uppercase text-muted-foreground">
            Round {round}
            {round > 1 && <span className="rounded bg-orange-500 px-1.5 py-0.5 text-[10px] text-white">Added</span>}
          </span>
          <span className="flex items-center gap-1">
            <span className={`rounded-md px-1.5 py-0.5 text-xs font-black ${timerClass(age)}`}>⏱ {age} min</span>
            <PrintButton orderId={order.id} kind="kot" label="🖨" className="pos-btn no-select rounded-md bg-elevated px-1.5 py-0.5 text-xs" />
          </span>
        </div>
      )}
      {!order.just_cancelled && orderHasChanges(order) && (
        <div className="mb-1 text-[10px] font-black text-red-700 bg-red-100 border border-red-300 rounded px-2 py-0.5 inline-block">⚠ ITEMS CHANGED SINCE SENT</div>
      )}
      {order.scheduled_for && (
        <div className="text-purple-700 text-xs font-bold mb-1">
          ⏰ For {new Date(order.scheduled_for).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "numeric", minute: "2-digit" })}
        </div>
      )}
      <div>
        {order.items.map((item) => (
          <ItemRow key={item.id} item={item} orderId={order.id} canBump={canBump} onBumpItem={onBumpItem} />
        ))}
      </div>
      {order.notes && <div className="mt-1.5 bg-yellow-100 border border-yellow-300 rounded-lg px-2 py-1 text-yellow-800 text-xs">📝 {order.notes}</div>}
    </div>
  );
}

// A table (every round still cooking) or one takeaway/delivery order.
function OrderBox({
  group,
  width,
  flash,
  onBumpAll,
  onBumpItem,
}: {
  group: OrderWithItems[];
  width: number;
  flash: boolean;
  onBumpAll: (orderIds: number[]) => void;
  onBumpItem: (orderId: number, itemId: number, status: "ready" | "pending") => void;
}) {
  const first = group[0];
  const age = getAgeMinutes(first.created_at);
  const labelled = group.length > 1 || (first.round ?? 1) > 1;
  return (
    <div
      style={{ width, flex: `0 0 ${width}px` }}
      className={`max-h-full flex flex-col rounded-xl border-[3px] bg-surface overflow-hidden transition-shadow ${boxClass(group)} ${flash ? "ring-4 ring-blue-500 ring-offset-2" : ""}`}
    >
      <div className={`flex-shrink-0 px-3 py-2 border-b border-border ${headClass(group)}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xl lg:text-2xl font-black text-foreground leading-tight truncate">{boxTitle(first)}</span>
          {!first.just_cancelled && (
            <span className={`flex-shrink-0 rounded-md px-1.5 py-0.5 text-xs font-black ${timerClass(age)}`}>⏱ {age}m</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">{boxSubtitle(group)}</div>
        {first.just_cancelled && <div className="mt-1 text-xs font-black text-red-700">❌ CANCELLED — stop prep</div>}
      </div>

      <div className="flex-shrink min-h-0 overflow-y-auto overscroll-contain px-3 pb-2">
        {group.map((order) => (
          <RoundSection key={order.id} order={order} showLabel={labelled} onBumpItem={onBumpItem} />
        ))}
      </div>

      {!first.just_cancelled && (
        <div className="flex-shrink-0 flex gap-2 border-t border-border p-2">
          {!labelled && (
            <PrintButton orderId={first.id} kind="kot" label="🖨" className="pos-btn no-select rounded-lg bg-elevated px-3 py-2.5 text-sm" />
          )}
          <button
            onClick={() => onBumpAll(group.map((o) => o.id))}
            className="pos-btn no-select flex-1 rounded-lg bg-green-600 py-2.5 text-sm font-bold text-white hover:bg-green-500"
          >
            ⚡ Bump All
          </button>
        </div>
      )}
    </div>
  );
}

// Ready orders are the cashier's now, so they're a compact chip, not a box.
function ReadyChip({ group, onRecall }: { group: OrderWithItems[]; onRecall: (orderIds: number[]) => void }) {
  const rep = group[0];
  const label = rep.table_number ? `${rep.table_number}${group.length > 1 ? ` · ${group.length} ready` : ""}` : rep.order_number;
  return (
    <div className="flex items-center gap-1.5 bg-green-100 border border-green-300 rounded-full px-3 py-1.5 flex-shrink-0">
      <span className="text-green-600 text-sm">✓</span>
      <span className="text-foreground text-sm font-bold">{label}</span>
      {!rep.table_number && <span className="text-muted-foreground text-xs capitalize">{rep.order_type.replace("_", " ")}</span>}
      <button
        onClick={() => onRecall(group.map((o) => o.id))}
        title="Bumped by mistake? Send back to the kitchen."
        className="pos-btn no-select ml-1 text-green-700 hover:text-green-900 text-xs font-bold border border-green-300 rounded-full px-2 py-0.5 bg-white/50 hover:bg-white transition-colors"
      >
        ↺ Recall
      </button>
    </div>
  );
}

// One tab per box. Colour = how long it's been waiting (same as the timers).
function tabClass(group: OrderWithItems[]): string {
  if (group[0].just_cancelled) return "bg-red-600 text-white border-red-700";
  const age = getAgeMinutes(group[0].created_at);
  if (age >= 20) return "bg-red-600 text-white border-red-700";
  if (age >= 10) return "bg-orange-100 text-orange-800 border-orange-400";
  return "bg-yellow-100 text-yellow-900 border-yellow-400";
}

// kitchenOnly: signed in as Kitchen staff — no way back to the till, just
// Log out (back to the PIN pad).
export default function KitchenBoard({ kitchenOnly = false }: { kitchenOnly?: boolean }) {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [, setTick] = useState(0);
  const [boardWidth, setBoardWidth] = useState(0);
  const [screen, setScreen] = useState(0);
  // Boxes (by their first order's id) with a new ticket nobody has looked at yet.
  const [bellKeys, setBellKeys] = useState<number[]>([]);
  // The box just picked from the tabs, outlined for a moment so it's easy to spot.
  const [flashKey, setFlashKey] = useState<number | null>(null);
  const seenIds = useRef<Set<number> | null>(null);
  // True after the first successful load — the bell only counts orders that
  // arrive after that, never the ones already there when the screen opened.
  const [loadedOnce, setLoadedOnce] = useState(false);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/kitchen", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setOrders(data.orders || []);
      setLastRefresh(new Date());
      setLoadedOnce(true);
    } catch (err) {
      console.error("Failed to fetch kitchen orders", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  // Re-render every 30s so the timers move without refetching.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // The board's width decides how many boxes fit (a callback ref, since the
  // board only mounts once loading is done).
  const observer = useRef<ResizeObserver | null>(null);
  const boardRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (el) {
      const ro = new ResizeObserver((entries) => setBoardWidth(entries[0].contentRect.width));
      ro.observe(el);
      observer.current = ro;
    }
  }, []);

  const handleStatusUpdate = async (orderId: number, status: string) => {
    try {
      await fetch("/api/kitchen", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status }),
      });
    } catch (err) {
      console.error("Failed to update order status", err);
    }
  };

  const handleBumpAll = async (orderIds: number[]) => {
    await Promise.all(orderIds.map((id) => handleStatusUpdate(id, "ready")));
    fetchOrders();
  };

  const handleRecall = async (orderIds: number[]) => {
    await Promise.all(orderIds.map((id) => handleStatusUpdate(id, "sent_to_kitchen")));
    fetchOrders();
  };

  const handleBumpItem = async (orderId: number, itemId: number, status: "ready" | "pending") => {
    try {
      await fetch(`/api/orders/${orderId}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, status }),
      });
      fetchOrders();
    } catch (err) {
      console.error("Failed to bump item", err);
    }
  };

  // Memoized on `orders` so the derived arrays keep a stable identity
  // between the 30s timer re-renders.
  const activeOrders = useMemo(
    () => [...orders.filter((o) => o.just_cancelled), ...orders.filter((o) => !o.just_cancelled && o.status !== "ready")],
    [orders]
  );
  const readyOrders = useMemo(() => orders.filter((o) => o.status === "ready" && !o.just_cancelled), [orders]);
  const activeGroups = useMemo(() => groupByTable(activeOrders), [activeOrders]);
  const readyGroups = useMemo(() => groupByTable(readyOrders), [readyOrders]);

  const perScreen = boardWidth > 0 ? boxesPerScreen(boardWidth) : 1;
  const width = boardWidth > 0 ? boxWidth(boardWidth, perScreen) : 280;
  const screens = screenCount(activeGroups.length, perScreen);
  const current = Math.min(screen, screens - 1);
  const visible = activeGroups.slice(current * perScreen, current * perScreen + perScreen);
  const visibleKeys = visible.map((g) => g[0].id).join(",");
  const onScreen = useMemo(() => new Set(visibleKeys ? visibleKeys.split(",").map(Number) : []), [visibleKeys]);

  // 🔔 A new ticket (a new table/order, or another round) that lands on a
  // box that isn't on screen. Staff stay where they are.
  useEffect(() => {
    const ids = new Set(activeOrders.map((o) => o.id));
    if (seenIds.current === null) {
      if (loadedOnce) seenIds.current = ids;
      return;
    }
    const fresh: number[] = [];
    activeGroups.forEach((g, i) => {
      if (screenOf(i, perScreen) !== current && g.some((o) => !seenIds.current!.has(o.id))) fresh.push(g[0].id);
    });
    seenIds.current = ids;
    if (fresh.length) setBellKeys((b) => [...new Set([...b, ...fresh])]);
  }, [activeOrders, activeGroups, perScreen, current, loadedOnce]);

  // A box on screen has been seen; boxes that are gone lose their bell.
  useEffect(() => {
    const live = new Set(activeGroups.map((g) => g[0].id));
    setBellKeys((b) => (b.some((k) => onScreen.has(k) || !live.has(k)) ? b.filter((k) => !onScreen.has(k) && live.has(k)) : b));
  }, [onScreen, activeGroups]);

  useEffect(() => {
    if (flashKey === null) return;
    const t = setTimeout(() => setFlashKey(null), 1500);
    return () => clearTimeout(t);
  }, [flashKey]);

  const jumpTo = (index: number) => {
    setScreen(screenOf(index, perScreen));
    setFlashKey(activeGroups[index][0].id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground text-xl animate-pulse">Loading kitchen orders...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-surface border-b border-border px-3 sm:px-5 py-2 flex-shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {kitchenOnly ? (
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
                  window.location.replace("/pin");
                }}
                className="px-2.5 py-1.5 bg-surface-hover hover:bg-elevated text-foreground text-xs sm:text-sm font-semibold rounded-lg border border-border"
              >
                Log out
              </button>
            ) : (
              <Link href="/pos" className="px-2.5 py-1.5 bg-surface-hover hover:bg-elevated text-foreground text-xs sm:text-sm font-semibold rounded-lg border border-border">
                ← Back
              </Link>
            )}
            <h1 style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-foreground font-semibold text-base sm:text-xl tracking-[-0.02em]">
              🍳 Kitchen Display
            </h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
            <span className="text-yellow-600 text-xs sm:text-sm font-medium">● New: {orders.filter((o) => o.status === "sent_to_kitchen").length}</span>
            <span className="text-green-600 text-xs sm:text-sm font-medium">● Ready: {readyOrders.length}</span>
            {orders.some((o) => o.just_cancelled) && (
              <span className="text-red-600 text-xs sm:text-sm font-bold animate-pulse">● Cancelled: {orders.filter((o) => o.just_cancelled).length}</span>
            )}
            <span className="text-muted-foreground text-[10px] sm:text-xs hidden lg:inline">
              Updated {lastRefresh.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <button onClick={fetchOrders} className="px-2.5 py-1.5 bg-surface-hover hover:bg-elevated text-foreground text-xs font-semibold rounded-lg border border-border">
              ↻ Refresh
            </button>
          </div>
        </div>
      </div>

      <TableRequestsBanner />

      <div className="flex-1 min-h-0 p-2.5 sm:p-3 flex flex-col gap-2.5">
        {/* One tab per box — tap to jump to it */}
        {activeGroups.length > 0 && (
          <div className="flex-shrink-0 flex flex-wrap items-center gap-2" role="tablist" aria-label="Orders">
            {activeGroups.map((group, i) => {
              const key = group[0].id;
              const shown = onScreen.has(key);
              const bell = bellKeys.includes(key);
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={shown}
                  onClick={() => jumpTo(i)}
                  className={`pos-btn no-select flex items-center gap-1.5 rounded-xl border-2 px-3 py-2 text-sm sm:text-base font-black ${tabClass(group)} ${
                    shown ? "ring-[3px] ring-foreground ring-offset-1" : "opacity-80"
                  } ${bell ? "animate-pulse" : ""}`}
                >
                  {bell && <span aria-label="new">🔔</span>}
                  {group[0].just_cancelled && <span>✕</span>}
                  {tabLabel(group[0])}
                  {!group[0].just_cancelled && <span className="text-xs font-bold opacity-75">{getAgeMinutes(group[0].created_at)}m</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Ready strip */}
        {readyGroups.length > 0 && (
          <div className="flex-shrink-0 flex flex-wrap items-center gap-2 min-w-0">
            <span className="text-sm font-bold text-foreground">✅ Ready</span>
            {readyGroups.map((group) => (
              <ReadyChip key={group[0].id} group={group} onRecall={handleRecall} />
            ))}
          </div>
        )}

        {/* The boxes */}
        <div ref={boardRef} className="flex-1 min-h-0">
          {activeGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <span className="text-6xl">✅</span>
              <p className="text-xl font-semibold">All caught up!</p>
              <p className="text-sm">No orders cooking</p>
            </div>
          ) : (
            <div className="flex h-full items-start" style={{ gap: BOX_GAP }}>
              {visible.map((group) => (
                <OrderBox key={group[0].id} group={group} width={width} flash={flashKey === group[0].id} onBumpAll={handleBumpAll} onBumpItem={handleBumpItem} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
