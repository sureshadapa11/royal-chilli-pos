"use client";

import { hasAllergy, allergyText } from "@/lib/allergy";
import { useState, useEffect, useCallback } from "react";
import { formatCurrency } from "@/lib/utils";
import PaymentModal from "@/components/pos/PaymentModal";
import type { CartItem } from "@/lib/types";

interface OnlineOrderItem {
  id: number;
  item_name: string;
  item_price: number;
  quantity: number;
  notes?: string;
  status: string;
}

interface OnlineOrder {
  allergy_allergens?: string[] | null;
  allergy_notes?: string | null;
  id: number;
  order_number: string;
  order_type: string;
  customer_name: string;
  customer_phone?: string;
  customer_address?: string;
  customer_id?: number | null;
  status: string;
  total: number;
  amount_paid: number;
  subtotal: number;
  tax?: number;
  notes?: string;
  created_at: string;
  scheduled_for?: string | null;
}

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  sent_to_kitchen: { label: "New",       color: "text-blue-700",    bg: "bg-blue-500/15 border-blue-500/40" },
  ready:           { label: "Ready",     color: "text-emerald-700", bg: "bg-emerald-500/15 border-emerald-500/40" },
  paid:            { label: "Paid",      color: "text-muted-foreground",    bg: "bg-surface-hover/60 border-border" },
  cancelled:       { label: "Cancelled", color: "text-red-600",     bg: "bg-red-50 border-red-800/40" },
};

export default function OnlineOrdersPanel() {
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [itemsCache, setItemsCache] = useState<Record<number, OnlineOrderItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<number | null>(null);

  // Payment modal state
  const [payOpen, setPayOpen] = useState(false);
  const [payOrder, setPayOrder] = useState<OnlineOrder | null>(null);
  const [payItems, setPayItems] = useState<CartItem[]>([]);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/orders?source=website&status=open", { cache: "no-store" });
      const data = await res.json();
      const list: OnlineOrder[] = data.orders || [];
      setOrders(list);
    } catch (err) {
      console.error("Failed to fetch online orders", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const t = setInterval(fetchOrders, 15000);
    return () => clearInterval(t);
  }, [fetchOrders]);

  const fetchItems = async (orderId: number) => {
    if (itemsCache[orderId]) return itemsCache[orderId];
    try {
      const res = await fetch(`/api/orders/${orderId}/items`);
      const data = await res.json();
      const items: OnlineOrderItem[] = data.items || [];
      setItemsCache(prev => ({ ...prev, [orderId]: items }));
      return items;
    } catch { return []; }
  };

  const handleExpand = async (orderId: number) => {
    if (expanded === orderId) { setExpanded(null); return; }
    setExpanded(orderId);
    await fetchItems(orderId);
  };

  const updateStatus = async (orderId: number, status: string) => {
    setUpdating(orderId);
    try {
      await fetch(`/api/orders/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await fetchOrders();
    } catch { /* silent */ }
    finally { setUpdating(null); }
  };

  const handleTakePayment = async (order: OnlineOrder) => {
    const raw = await fetchItems(order.id);
    const cartItems: CartItem[] = raw
      .filter(i => i.status !== "cancelled")
      .map(i => ({
        menu_item_id: 0,
        item_name: i.item_name,
        item_price: i.item_price,
        quantity: i.quantity,
        is_veg: 0,
        sent: true,
        db_id: i.id,
        order_id: order.id,
      }));
    setPayOrder(order);
    setPayItems(cartItems);
    setPayOpen(true);
  };

  const handlePaymentComplete = () => {
    fetchOrders();
  };

  const handlePaymentClose = () => {
    setPayOpen(false);
    setPayOrder(null);
    setPayItems([]);
    fetchOrders();
  };

  const timeAgo = (iso: string) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (diff < 1) return "just now";
    if (diff === 1) return "1 min ago";
    return `${diff} mins ago`;
  };

  if (loading) return (
    <div className="flex items-center justify-center h-32 text-muted-foreground text-sm animate-pulse">
      Loading online orders…
    </div>
  );

  if (orders.length === 0) return (
    <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
      <span className="text-3xl">🌐</span>
      <p className="text-sm">No active online orders</p>
      <p className="text-xs text-muted-foreground">Orders from your website appear here automatically</p>
    </div>
  );

  return (
    <>
      <div className="space-y-2">
        {orders.map(order => {
          const cfg = STATUS_CFG[order.status] ?? STATUS_CFG.sent_to_kitchen;
          const isOpen = expanded === order.id;
          const items = itemsCache[order.id] || [];
          const isDelivery = !!order.customer_address;
          const tax = order.tax ?? Math.round((order.total - order.total / 1.2) * 100) / 100;
          const paidOnline = order.amount_paid >= order.total;

          return (
            <div key={order.id} className={`rounded-xl border overflow-hidden transition-all ${cfg.bg}`}>

              {/* Header row */}
              <button
                className="w-full flex items-center gap-3 px-3 py-3 text-left no-select"
                onClick={() => handleExpand(order.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-foreground font-bold text-sm">{order.customer_name}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    {paidOnline && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-emerald-500/15 border-emerald-500/40 text-emerald-700">
                        ✓ Paid Online
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground font-semibold">
                      {isDelivery ? "🛵 Delivery" : "🥡 Collection"}
                    </span>
                    {order.scheduled_for && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-purple-500/15 border-purple-500/40 text-purple-700">
                        ⏰ {new Date(order.scheduled_for).toLocaleString("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-muted-foreground">{order.order_number}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-[11px] text-muted-foreground">{timeAgo(order.created_at)}</span>
                    {order.customer_phone && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <a href={`tel:${order.customer_phone}`}
                          className="text-[11px] text-blue-600 hover:underline"
                          onClick={e => e.stopPropagation()}>
                          {order.customer_phone}
                        </a>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-foreground font-black text-base">{formatCurrency(order.total)}</div>
                  <div className="text-muted-foreground text-[10px]">{isOpen ? "▲" : "▼"}</div>
                </div>
              </button>

              {/* Expanded details */}
              {isOpen && (
                <div className="border-t border-white/5 px-3 pb-3 pt-2 space-y-2">

                  {order.customer_address && (
                    <div className="text-[11px] text-muted-foreground bg-surface/60 rounded-lg px-2.5 py-2">
                      📍 {order.customer_address}
                    </div>
                  )}

                  {hasAllergy(order) && (
                    <div className="text-xs font-bold text-red-800 bg-red-50 border-2 border-red-500 rounded-lg px-2.5 py-2">⚠️ ALLERGY: {allergyText(order)}</div>
                  )}
                  {order.notes && (
                    <div className="text-[11px] text-amber-700 bg-amber-100 border border-amber-800/40 rounded-lg px-2.5 py-2">
                      📝 {order.notes}
                    </div>
                  )}

                  {/* Items */}
                  {items.length === 0 ? (
                    <p className="text-muted-foreground text-xs animate-pulse">Loading items…</p>
                  ) : (
                    <div className="space-y-1">
                      {items.map(item => (
                        <div key={item.id} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-foreground flex-1">
                            <span className="text-foreground font-semibold">{item.quantity}×</span> {item.item_name}
                            {item.notes && <span className="text-muted-foreground"> — {item.notes}</span>}
                          </span>
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {formatCurrency(item.item_price * item.quantity)}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-1.5 border-t border-white/5">
                        <span className="text-xs text-muted-foreground">Total</span>
                        <span className="text-sm font-black text-foreground">{formatCurrency(order.total)}</span>
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-1">
                    {paidOnline ? (
                      <div className="flex-1 h-10 bg-emerald-500/10 border border-emerald-500/40 text-emerald-700 text-sm font-bold rounded-lg flex items-center justify-center gap-2">
                        ✓ Paid Online — {formatCurrency(order.amount_paid)}
                      </div>
                    ) : (
                      <button
                        onClick={() => handleTakePayment(order)}
                        disabled={updating === order.id}
                        className="flex-1 h-10 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg transition-all disabled:opacity-50 no-select flex items-center justify-center gap-2"
                      >
                        💰 Take Payment — {formatCurrency(order.total)}
                      </button>
                    )}
                    <button
                      onClick={() => updateStatus(order.id, "cancelled")}
                      disabled={updating === order.id}
                      className="h-10 px-3 bg-surface-hover hover:bg-red-950 border border-border hover:border-red-300 text-muted-foreground hover:text-red-600 text-xs font-semibold rounded-lg transition-all disabled:opacity-50 no-select"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Payment Modal */}
      {payOrder && (
        <PaymentModal
          open={payOpen}
          onClose={handlePaymentClose}
          orderId={payOrder.id}
          orderNumber={payOrder.order_number}
          customerId={payOrder.customer_id ?? null}
          extraOrderIds={[]}
          items={payItems}
          subtotal={payOrder.subtotal ?? payOrder.total}
          discount={0}
          tax={payOrder.tax ?? Math.round((payOrder.total - payOrder.total / 1.2) * 100) / 100}
          total={payOrder.total}
          amountPaid={payOrder.amount_paid ?? 0}
          onPaymentComplete={handlePaymentComplete}
        />
      )}
    </>
  );
}
