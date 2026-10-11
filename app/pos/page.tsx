"use client";

import { useState, useEffect, useCallback } from "react";
import { isManagerRole, roleLabel } from "@/lib/roles";
import { initials, type Brand } from "@/lib/brand-client";
import { useRouter } from "next/navigation";
import { formatCurrency, isHappyHour, isBreakfastTime } from "@/lib/utils";
import OrderTypeSelector from "@/components/pos/OrderTypeSelector";
import TableGrid from "@/components/pos/TableGrid";
import MenuPanel from "@/components/pos/MenuPanel";
import OrderTicket from "@/components/pos/OrderTicket";
import PaymentModal from "@/components/pos/PaymentModal";
import OnlineOrdersPanel from "@/components/pos/OnlineOrdersPanel";
import OpenOrdersPanel from "@/components/pos/OpenOrdersPanel";
import CustomerDetailsModal from "@/components/pos/CustomerDetailsModal";
import TableRequestsBanner from "@/components/pos/TableRequestsBanner";
import CloseDayReminder from "@/components/pos/CloseDayReminder";
import BusyModeControl from "@/components/pos/BusyModeControl";
import { londonDateStr } from "@/lib/london-date";
import ZReportView from "@/components/pos/ZReportView";
import type { ZReport } from "@/lib/z-report";
import type {
  MenuCategory,
  MenuItem,
  RestaurantTable,
  CartItem,
  WorkPeriod,
} from "@/lib/types";
import { confirmDialog } from "@/components/ui/confirm";
import { freshStart } from "@/lib/auth-sync";

type OrderType = "dine_in" | "takeaway" | "delivery" | "online";
type MobileTab = "floor" | "menu" | "order";

interface SessionUser {
  id: number;
  name: string;
  role: string;
}

export default function POSPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  // This business's name / logo (each business is independent) — /api/auth/me.
  const [brand, setBrand] = useState<Brand | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Menu data
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [upcomingReservationCount, setUpcomingReservationCount] = useState(0);

  // Order state
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [notes, setNotes] = useState("");

  // Dine-in: must pick a table before adding items. Takeaway/delivery: items
  // come first, customer details are asked for when sending/paying.
  const [showTablePopup, setShowTablePopup] = useState(false);
  const [showCustomerPopup, setShowCustomerPopup] = useState(false);
  const [customerDetailsCollected, setCustomerDetailsCollected] = useState(false);
  const [pendingAction, setPendingAction] = useState<"kitchen" | "payment" | null>(null);

  // Payment state
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<number | null>(null);
  const [currentOrderNumber, setCurrentOrderNumber] = useState("");
  const [allOrderIds, setAllOrderIds] = useState<number[]>([]);
  const [currentCustomerId, setCurrentCustomerId] = useState<number | null>(null);
  // Sum of amount_paid across every order merged onto the current table/cart
  // — set only by recallOrderForTable (a fresh order always starts at 0).
  // PaymentModal needs this to know the TRUE remaining balance; without it,
  // reopening Pay Now on a partially-paid order shows the full bill again.
  const [currentAmountPaid, setCurrentAmountPaid] = useState(0);

  // UI state
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("floor");
  const [clickPos, setClickPos] = useState<{ x: number; y: number } | null>(null);
  const [onlineBadge, setOnlineBadge] = useState(0);
  const [reservationBadge, setReservationBadge] = useState(0);
  const [showCashOutModal, setShowCashOutModal] = useState(false);
  const [cashOutAmount, setCashOutAmount] = useState("");
  const [cashOutReason, setCashOutReason] = useState("");
  const [cashOutSaving, setCashOutSaving] = useState(false);
  const [cashOutError, setCashOutError] = useState("");
  const [showMobileMenu, setShowMobileMenu] = useState(false);


  // End of Day modal
  const [endOfDayOpen, setEndOfDayOpen] = useState(false);
  const [eodData, setEodData] = useState<ZReport | null>(null);
  const [eodClosingCash, setEodClosingCash] = useState("");
  const [eodPrintStatus, setEodPrintStatus] = useState("");
  const [eodCloseNote, setEodCloseNote] = useState("");
  const [eodLoading, setEodLoading] = useState(false);
  const [eodClosed, setEodClosed] = useState(false);
  const [eodError, setEodError] = useState("");

  // Till (shift) open/close gate
  const [tillPeriod, setTillPeriod] = useState<WorkPeriod | null>(null);
  const [tillChecked, setTillChecked] = useState(false);
  const [tillFetchFailed, setTillFetchFailed] = useState(false);
  const [tillBypassed, setTillBypassed] = useState(false);
  const [openingCashInput, setOpeningCashInput] = useState("");
  const [openTillLoading, setOpenTillLoading] = useState(false);
  const [openTillError, setOpenTillError] = useState("");

  // Track last click/tap position for context-aware toast
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      const src = "touches" in e ? e.touches[0] : e;
      if (src) setClickPos({ x: src.clientX, y: src.clientY });
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("touchstart", handler as EventListener);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("touchstart", handler as EventListener);
    };
  }, []);

  // Auto-clear status toast after 3 seconds
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(""), 3000);
    return () => clearTimeout(t);
  }, [status]);

  const happyHour = isHappyHour();
  const breakfastTime = isBreakfastTime();
  const isManager = !!session && isManagerRole(session.role);

  // Computed totals — exclude voided items. Item prices are VAT-inclusive
  // (see lib/order-totals.ts computeBill) — total is just subtotal minus
  // discount, never with VAT added on top; tax is the 20% VAT component
  // embedded in that total, shown for information only.
  const subtotal = cartItems.filter(i => !i.voided).reduce(
    (sum, i) => sum + i.item_price * i.quantity, 0
  );
  const total = Math.round((subtotal - discount) * 100) / 100;
  const tax = Math.round((total - total / 1.2) * 100) / 100;
  const unsentCount = cartItems.filter(i => !i.sent && !i.voided).length;
  const cartCount = cartItems.filter(i => !i.voided).reduce((s, i) => s + i.quantity, 0);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadMenuData();
    loadSession();
    checkTillStatus();
  }, []);

  // Runs regardless of which tab is active — OnlineOrdersPanel only mounts
  // (and only polls) while staff are actually on the Online tab, so without
  // this the badge count would freeze until they clicked into it.
  useEffect(() => {
    const fetchOnlineBadge = async () => {
      try {
        const res = await fetch("/api/orders?source=website&status=open", { cache: "no-store" });
        const data = await res.json();
        const orders: { status: string }[] = data.orders || [];
        setOnlineBadge(orders.filter(o => o.status === "sent_to_kitchen").length);
      } catch {
        // silent — badge just skips this tick
      }
    };
    fetchOnlineBadge();
    const t = setInterval(fetchOnlineBadge, 15000);
    return () => clearInterval(t);
  }, []);

  // "New bookings since staff last opened Reservations" — not a live pending
  // count, since a reservation staying "pending" shouldn't keep re-alerting
  // once someone's already seen it. /pos/reservations stamps this timestamp
  // in localStorage on mount, so opening that page clears the badge even if
  // the bookings underneath are still unprocessed.
  useEffect(() => {
    const fetchReservationBadge = async () => {
      try {
        const lastSeen = localStorage.getItem("pos_reservations_last_seen") || "1970-01-01T00:00:00.000Z";
        const today = londonDateStr();
        const res = await fetch(`/api/reservations?from=${today}`, { cache: "no-store" });
        const data = await res.json();
        const list: { created_at: string }[] = data.reservations || [];
        setReservationBadge(list.filter(r => r.created_at > lastSeen).length);
      } catch {
        // silent — badge just skips this tick
      }
    };
    fetchReservationBadge();
    const t = setInterval(fetchReservationBadge, 15000);
    return () => clearInterval(t);
  }, []);

  const checkTillStatus = async () => {
    try {
      const res = await fetch("/api/work-periods", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setTillPeriod(data.period && data.period.status === "open" ? data.period : null);
      setTillFetchFailed(false);
    } catch {
      // Fail open — never lock staff out of taking orders because of a network blip.
      setTillFetchFailed(true);
    } finally {
      setTillChecked(true);
    }
  };

  const handleOpenTill = async () => {
    setOpenTillLoading(true);
    setOpenTillError("");
    try {
      const res = await fetch("/api/work-periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opening_cash: parseFloat(openingCashInput) || 0,
          staff_id: session?.id,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTillPeriod(data.period);
        setOpeningCashInput("");
      } else {
        const data = await res.json().catch(() => ({}));
        setOpenTillError(data.error || "Failed to open the till. Try again.");
      }
    } catch {
      setOpenTillError("Failed to open the till. Try again.");
    } finally {
      setOpenTillLoading(false);
    }
  };


  const loadSession = async () => {
    try {
      const res = await fetch("/api/orders?status=open");
      if (!res.ok) {
        window.location.replace("/login");
        return;
      }
      // Fetch session user details
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const meData = await meRes.json();
        // Kitchen staff only use the Kitchen Display.
        if (meData.user?.role === "kitchen") {
          window.location.replace("/pos/kitchen");
          return;
        }
        setSession(meData.user);
        setBrand(meData.brand ?? null);
      }
    } catch {
      window.location.replace("/login");
    }
  };

  const loadMenuData = async () => {
    try {
      const [menuRes, tablesRes] = await Promise.all([
        fetch("/api/menu"),
        fetch("/api/tables"),
      ]);
      const menuData = await menuRes.json();
      const tablesData = await tablesRes.json();
      setCategories(menuData.categories || []);
      setItems(menuData.items || []);
      setTables(tablesData.tables || []);
      setUpcomingReservationCount(tablesData.upcomingReservationCount || 0);
    } catch {
      console.error("Failed to load menu data");
    }
  };

  const refreshTables = useCallback(async () => {
    const res = await fetch("/api/tables");
    const data = await res.json();
    setTables(data.tables || []);
    setUpcomingReservationCount(data.upcomingReservationCount || 0);
  }, []);

  const toggleSelfOrder = async (tableId: number, enabled: boolean) => {
    setTables((prev) => prev.map((t) => (t.id === tableId ? { ...t, self_order_enabled: enabled } : t)));
    try {
      await fetch("/api/tables", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tableId, self_order_enabled: enabled }),
      });
    } catch {
      refreshTables();
    }
  };

  // Manual status flip with no order attached — the merged-tables workflow:
  // the real order sits on one "primary" table, and the others physically
  // pushed together for the same party get flagged Occupied by hand here so
  // they can't be double-booked, then flipped back to Available once the
  // party leaves. No merge/group concept in the schema, deliberately — see
  // the table-merge discussion this session for why the simple version won
  // over a real multi-table link.
  const handleTableStatusChange = async (tableId: number, status: "available" | "occupied" | "reserved") => {
    setTables((prev) => prev.map((t) => (t.id === tableId ? { ...t, status } : t)));
    try {
      await fetch("/api/tables", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tableId, status }),
      });
    } catch {
      refreshTables();
    }
  };

  // Two lines only merge if they're the same dish with the exact same
  // modifier selections — e.g. "Chicken Tikka" and "Malai Tikka" versions of
  // the same platter must stay as separate lines, same rule as the website cart.
  const modifierKey = (mods?: CartItem["selected_modifiers"]) =>
    (mods || []).map((m) => m.id).sort((a, b) => a - b).join(",");

  const handleAddItem = (item: CartItem) => {
    setCartItems((prev) => {
      const existing = prev.findIndex(
        (i) => i.menu_item_id === item.menu_item_id && !i.sent && modifierKey(i.selected_modifiers) === modifierKey(item.selected_modifiers)
      );
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { ...updated[existing], quantity: updated[existing].quantity + 1 };
        return updated;
      }
      return [...prev, item];
    });
  };

  const handleUpdateQty = (idx: number, qty: number) => {
    if (cartItems[idx]?.sent) return;
    if (qty <= 0) {
      handleRemoveItem(idx);
      return;
    }
    setCartItems((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], quantity: qty };
      return updated;
    });
  };

  const handleRemoveItem = (idx: number) => {
    if (cartItems[idx]?.sent) return;
    setCartItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleVoidItem = async (idx: number, newQty: number) => {
    const item = cartItems[idx];
    if (!item?.db_id || !item?.order_id) return;
    try {
      if (newQty === 0) {
        await fetch(`/api/orders/${item.order_id}/items`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: item.db_id, action: "void" }),
        });
        setCartItems(prev => prev.map((i, n) => n === idx ? { ...i, voided: true } : i));
      } else {
        await fetch(`/api/orders/${item.order_id}/items`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: item.db_id, action: "reduce", quantity: newQty }),
        });
        setCartItems(prev => prev.map((i, n) => n === idx ? { ...i, quantity: newQty } : i));
      }
    } catch {
      // silent
    }
  };

  const handleSetDiscount = (d: number, reason: string) => {
    setDiscount(d);
    setDiscountReason(reason);
  };

  const handleOrderTypeChange = (type: OrderType) => {
    setOrderType(type);
    setSelectedTable(null);
    setCartItems([]);
    setDiscount(0);
    setDiscountReason("");
    setCurrentOrderId(null);
    setCurrentOrderNumber("");
    setAllOrderIds([]);
    setCurrentCustomerId(null);
    setCurrentAmountPaid(0);
    setShowCustomerForm(type !== "dine_in" && type !== "online");
    setShowTablePopup(false);
    setShowCustomerPopup(false);
    setCustomerDetailsCollected(false);
    setPendingAction(null);
    setMobileTab(type === "online" ? "order" : type === "dine_in" ? "floor" : "menu");
  };

  const recallOrderForTable = useCallback(async (tableId: number) => {
    try {
      const res = await fetch(`/api/orders?table_id=${tableId}&status=open`);
      const data = await res.json();
      const orders: { id: number; order_number: string; discount: number; discount_reason: string | null; customer_id: number | null; amount_paid: number }[] = data.orders || [];
      if (orders.length === 0) return false;
      const ordersOldFirst = [...orders].reverse();
      const allItems: CartItem[] = [];
      for (const order of ordersOldFirst) {
        const itemsRes = await fetch(`/api/orders/${order.id}/items`);
        const itemsData = await itemsRes.json();
        const items: CartItem[] = (itemsData.items || [])
          .filter((i: { status: string }) => i.status !== "cancelled")
          .map((i: { id: number; menu_item_id: number; item_name: string; item_price: number; quantity: number; is_veg?: number }) => ({
            menu_item_id: i.menu_item_id,
            item_name: i.item_name,
            item_price: i.item_price,
            quantity: i.quantity,
            is_veg: i.is_veg ?? 0,
            sent: true,
            db_id: i.id,
            order_id: order.id,
          }));
        allItems.push(...items);
      }
      const firstOrder = ordersOldFirst[0];
      setCartItems(allItems);
      setCurrentOrderId(firstOrder.id);
      setCurrentOrderNumber(firstOrder.order_number);
      setAllOrderIds(ordersOldFirst.map(o => o.id));
      setDiscount(firstOrder.discount ?? 0);
      setDiscountReason(firstOrder.discount_reason ?? "");
      setCurrentCustomerId(firstOrder.customer_id ?? null);
      setCurrentAmountPaid(ordersOldFirst.reduce((sum, o) => sum + Number(o.amount_paid ?? 0), 0));
      return true;
    } catch {
      return false;
    }
  }, []);

  // Returns whether the new items were saved (Pay Now needs to know).
  const handleSendToKitchen = async (): Promise<boolean> => {
    const newItems = cartItems.filter(i => !i.sent);
    if (newItems.length === 0) return true;
    if (orderType === "dine_in" && !selectedTable) return false;
    setLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_type: orderType,
          table_id: selectedTable,
          customer_name: customerName || null,
          customer_phone: customerPhone || null,
          customer_address: customerAddress || null,
          items: newItems,
          notes,
          discount: currentOrderId ? 0 : discount,
          discount_reason: currentOrderId ? null : discountReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) return false;
      const orderId = data.order.id;
      await fetch(`/api/orders/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "sent_to_kitchen" }),
      });
      if (!currentOrderId) {
        setCurrentOrderId(orderId);
        setCurrentOrderNumber(data.order.order_number);
        setCurrentCustomerId(data.order.customer_id ?? null);
        setCurrentAmountPaid(0);
      }
      setAllOrderIds(prev => prev.includes(orderId) ? prev : [...prev, orderId]);
      const returnedItems: { id: number; menu_item_id: number }[] = data.items || [];
      let itemIdx = 0;
      setCartItems(prev => prev.map(i => {
        if (i.sent) return i;
        const dbItem = returnedItems[itemIdx++];
        return { ...i, sent: true, db_id: dbItem?.id, order_id: orderId };
      }));
      refreshTables();
      return true;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async () => {
    if (cartItems.length === 0) {
      setStatus("Please add items to the order");
      return;
    }
    if (orderType === "dine_in" && !selectedTable) {
      setStatus("Please select a table");
      return;
    }
    setLoading(true);
    try {
      if (!currentOrderId) {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_type: orderType,
            table_id: selectedTable,
            customer_name: customerName || null,
            customer_phone: customerPhone || null,
            customer_address: customerAddress || null,
            customer_email: customerEmail || null,
            marketing_consent: marketingConsent,
            items: cartItems,
            notes,
            discount,
            discount_reason: discountReason,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setStatus(data.error || "Failed to create order");
          return;
        }
        setCurrentOrderId(data.order.id);
        setCurrentOrderNumber(data.order.order_number);
        setCurrentCustomerId(data.order.customer_id ?? null);
        setCurrentAmountPaid(0);
        setAllOrderIds([data.order.id]);
      } else {
        // Items added since the bill was started aren't saved yet: send them
        // (a new round, like Send to Kitchen) or they'd be missing from the
        // bill the payment, rewards and receipt all read.
        if (cartItems.some(i => !i.sent) && !(await handleSendToKitchen())) {
          setStatus("Couldn't save the new items. Please try again.");
          return;
        }
        setLoading(true);
      }
      if (currentOrderId && customerPhone.trim()) {
        // Order already exists (e.g. dine-in sent to kitchen earlier) — a
        // phone just captured at payment time needs attaching after the
        // fact so loyalty picks it up when this payment completes.
        const attachRes = await fetch(`/api/orders/${currentOrderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customer_name: customerName || null, customer_phone: customerPhone, customer_email: customerEmail || null, marketing_consent: marketingConsent }),
        }).catch(() => null);
        const attachData = attachRes && attachRes.ok ? await attachRes.json().catch(() => null) : null;
        if (attachData?.order?.customer_id) setCurrentCustomerId(attachData.order.customer_id);
      }
      setPaymentOpen(true);
    } catch {
      setStatus("Failed to process order");
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentComplete = (remainingBalance?: number) => {
    // Keep the running "already paid" figure correct if the modal is
    // reopened later in this same session without switching tables —
    // recallOrderForTable refreshes it authoritatively from the DB anyway,
    // this just covers the gap before that next recall happens.
    if (remainingBalance !== undefined) setCurrentAmountPaid(Math.max(0, total - remainingBalance));
    refreshTables();
  };

  // Takeaway/delivery: items come first. The first time either action button
  // is pressed on one of these order types, ask for customer details instead
  // of proceeding straight away — then continue once they're confirmed.
  const requestSendToKitchen = () => {
    if ((orderType === "takeaway" || orderType === "delivery") && !customerDetailsCollected) {
      setPendingAction("kitchen");
      setShowCustomerPopup(true);
      return;
    }
    handleSendToKitchen();
  };

  const requestPayment = () => {
    if ((orderType === "takeaway" || orderType === "delivery" || orderType === "dine_in") && !customerDetailsCollected) {
      setPendingAction("payment");
      setShowCustomerPopup(true);
      return;
    }
    handlePayment();
  };

  const handleCustomerDetailsConfirm = () => {
    setCustomerDetailsCollected(true);
    setShowCustomerPopup(false);
    const action = pendingAction;
    setPendingAction(null);
    if (action === "kitchen") handleSendToKitchen();
    else if (action === "payment") handlePayment();
  };

  const handleCustomerDetailsCancel = () => {
    setShowCustomerPopup(false);
    setPendingAction(null);
  };

  const handlePaymentClose = () => {
    setPaymentOpen(false);
    if (currentOrderId) {
      handleClear();
    }
  };

  const handleClear = () => {
    setCartItems([]);
    setDiscount(0);
    setDiscountReason("");
    setSelectedTable(null);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerAddress("");
    setCustomerEmail("");
    setMarketingConsent(false);
    setNotes("");
    setCurrentOrderId(null);
    setCurrentOrderNumber("");
    setAllOrderIds([]);
    setCurrentCustomerId(null);
    setCurrentAmountPaid(0);
    setStatus("");
    setShowCustomerPopup(false);
    setCustomerDetailsCollected(false);
    setPendingAction(null);
    setMobileTab("floor");
    refreshTables();
  };

  // The Clear button: items not yet sent to the kitchen are erased, so ask first.
  const confirmClear = async () => {
    const unsent = cartItems.some((i) => !i.sent && !i.voided);
    if (unsent && !(await confirmDialog({ title: "Clear this order?", message: "The items not yet sent to the kitchen will be erased. Are you sure you want to proceed?", confirmLabel: "Yes, clear" }))) return;
    handleClear();
  };

  // A paired till goes back to the PIN pad; any other device to the password login.
  const handleLogout = async () => {
    const data = await fetch("/api/auth/logout", { method: "POST" }).then((r) => r.json()).catch(() => ({}));
    freshStart(data.till ? "/pin" : "/login");
  };

  const handleCashOut = async () => {
    setCashOutError("");
    const amt = parseFloat(cashOutAmount);
    if (!amt || amt <= 0) { setCashOutError("Enter an amount"); return; }
    if (!cashOutReason.trim()) { setCashOutError("A reason is required"); return; }
    setCashOutSaving(true);
    try {
      const res = await fetch("/api/work-periods/cash-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amt, reason: cashOutReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setCashOutError(data.error || "Failed to record cash out"); return; }
      setShowCashOutModal(false);
      setCashOutAmount("");
      setCashOutReason("");
    } catch {
      setCashOutError("Failed to record cash out");
    } finally {
      setCashOutSaving(false);
    }
  };

  const openEndOfDay = async () => {
    setEndOfDayOpen(true);
    setEodClosed(false);
    setEodData(null);
    setEodPrintStatus("");
    setEodClosingCash("");
    setEodCloseNote("");
    setEodError("");
    setEodLoading(true);
    try {
      const res = await fetch("/api/work-periods", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setEodData(data.report);
      } else {
        setEodError("Couldn't load today's summary. Try again.");
      }
    } catch {
      setEodError("Couldn't load today's summary. Try again.");
    } finally {
      setEodLoading(false);
    }
  };

  const handleCloseDay = async () => {
    setEodLoading(true);
    setEodError("");
    try {
      const res = await fetch("/api/work-periods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closing_cash: parseFloat(eodClosingCash) || 0,
          staff_id: session?.id,
          close_note: eodCloseNote,
        }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.report) setEodData(data.report);
        setEodClosed(true);
        setTillPeriod(null);
        // Close Day prints the Z report straight away, then signs out.
        const periodId = data.report?.period_id ?? data.period?.id;
        let printed = false;
        if (periodId) {
          printed = await fetch(`/api/work-periods/${periodId}/z-report`, { method: "POST" }).then((r) => r.ok).catch(() => false);
        }
        setEodPrintStatus(printed ? "Z report sent to printer ✓ — logging out…" : "Couldn't send the Z report to the printer — tap Print Z Report, then Log out.");
        if (printed) setTimeout(handleLogout, 4000);
      } else {
        const data = await res.json().catch(() => ({}));
        setEodError(data.error || "Failed to close the day. Try again.");
      }
    } catch {
      setEodError("Failed to close the day. Try again.");
    } finally {
      setEodLoading(false);
    }
  };

  // Sends the report to the Star printer (CloudPRNT) — a Z report once the
  // day is closed, an X report (running totals) before that.
  const handlePrintEod = async () => {
    if (!eodData) return;
    setEodPrintStatus("Sending…");
    try {
      const res = await fetch(`/api/work-periods/${eodData.period_id}/z-report`, { method: "POST" });
      setEodPrintStatus(res.ok ? "Sent to printer ✓" : "Couldn't send to printer. Try again.");
    } catch {
      setEodPrintStatus("Couldn't send to printer. Try again.");
    }
  };

  const handleTableSelect = async (t: RestaurantTable) => {
    if (t.id !== selectedTable) {
      setCartItems([]);
      setDiscount(0);
      setDiscountReason("");
      setCurrentOrderId(null);
      setCurrentOrderNumber("");
      setAllOrderIds([]);
      setCurrentCustomerId(null);
      setCurrentAmountPaid(0);
      setStatus("");
      // A fresh table is a fresh (potential) customer — the loyalty prompt
      // at payment must ask again, not carry over "skipped" from whichever
      // table was open before.
      setCustomerName("");
      setCustomerPhone("");
      setCustomerEmail("");
      setMarketingConsent(false);
      setCustomerDetailsCollected(false);
    }
    setSelectedTable(t.id);
    setMobileTab("menu");
    if (t.status === "occupied") {
      const found = await recallOrderForTable(t.id);
      if (!found) setStatus("No open bill found for this table");
    }
  };

  const timeStr = currentTime.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Shared table header card
  const tbl = tables.find(t => t.id === selectedTable);
  const tableHeader = tbl ? (
    <div className="relative rounded-2xl overflow-hidden border border-red-500/30 bg-gradient-to-br from-red-500/10 via-red-500/5 to-transparent">
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-500/0 via-red-400 to-red-500/0" />
      <div className="flex items-center gap-3 px-3 py-3">
        <div className="w-12 h-12 rounded-xl bg-red-500/20 border border-red-400/30 flex flex-col items-center justify-center flex-shrink-0 shadow-lg shadow-red-500/10">
          <span className="text-red-600/70 text-[9px] font-black leading-none tracking-widest uppercase">Table</span>
          <span className="text-red-200 text-lg font-black leading-tight">{tbl.table_number}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-foreground font-black text-base leading-tight">Table {tbl.join_label || tbl.table_number}</span>
            <span className="text-[9px] font-bold text-red-600 bg-red-500/15 border border-red-500/25 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
              {tbl.location === "outdoor" ? "Outdoor" : tbl.location === "private" ? "VIP" : "Main"}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-muted-foreground text-xs">🪑 {tbl.capacity} seats</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-emerald-600 text-xs font-semibold">● Active</span>
          </div>
        </div>
        <button
          onClick={() => { setSelectedTable(null); handleClear(); }}
          className="flex-shrink-0 text-[11px] font-semibold text-muted-foreground hover:text-red-600 bg-surface-hover/80 hover:bg-red-50 border border-border hover:border-red-500/40 px-2.5 py-1.5 rounded-lg transition-all no-select"
        >
          ← Tables
        </button>
      </div>
      {/* QR self-order gate — closed by default, and auto-closed again when
          the table is freed (see cancelOrderAndFreeTable / payment routes),
          so a QR code only ever works while staff has this table open. */}
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
        <span className="text-[11px] text-muted-foreground">📱 QR self-order for this table</span>
        <button
          onClick={() => toggleSelfOrder(tbl.id, !tbl.self_order_enabled)}
          className={`no-select flex-shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
            tbl.self_order_enabled
              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700"
              : "bg-surface-hover border-border text-muted-foreground"
          }`}
        >
          {tbl.self_order_enabled ? "● Open" : "○ Closed"}
        </button>
      </div>
    </div>
  ) : null;

  // Shared action buttons (totals + send + pay + clear)
  const actionButtons = (
    <div className="px-3 pb-3 pt-2 flex-shrink-0 border-t border-border/60 mt-2 space-y-2">
      {cartItems.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
          <span>{cartCount} items · VAT incl.</span>
          <div className="flex items-center gap-2">
            {discount > 0 && <span className="text-yellow-600">−{formatCurrency(discount)}</span>}
            <span className="text-muted-foreground">VAT {formatCurrency(tax)}</span>
            <span className="text-foreground font-bold">{formatCurrency(total)}</span>
          </div>
        </div>
      )}
      {currentAmountPaid > 0 && (
        <div className="flex items-center justify-between text-xs px-1">
          <span className="text-emerald-700 font-semibold">✓ Already paid {formatCurrency(currentAmountPaid)}</span>
          <span className="text-foreground font-bold">{formatCurrency(Math.max(0, total - currentAmountPaid))} remaining</span>
        </div>
      )}
      {cartItems.some(i => !i.sent) && (
        <button onClick={requestSendToKitchen} disabled={loading}
          className="pos-btn no-select w-full h-12 bg-red-600 hover:bg-red-500 disabled:bg-surface-hover disabled:text-muted-foreground text-white font-bold rounded-xl transition-all text-sm flex items-center justify-center gap-2">
          {loading ? <span className="opacity-60">Processing…</span> : <><span>🍳</span><span>Send to Kitchen</span></>}
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={requestPayment} disabled={loading || cartItems.length === 0}
          className="pos-btn no-select h-12 bg-emerald-600 hover:bg-emerald-500 disabled:bg-surface-hover disabled:text-muted-foreground text-white rounded-xl transition-all flex flex-col items-center justify-center leading-tight">
          <span className="text-[10px] font-semibold opacity-80">Pay Now</span>
          <span className="text-base font-black">{cartItems.length > 0 ? formatCurrency(Math.max(0, total - currentAmountPaid)) : "—"}</span>
        </button>
        <button onClick={confirmClear} disabled={loading}
          className="pos-btn no-select h-12 bg-surface-hover hover:bg-elevated border border-border text-foreground hover:text-foreground font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-1.5">
          <span>🗑️</span><span>Clear</span>
        </button>
      </div>
    </div>
  );

  // Bottom tab bar config
  const mobileTabs: { key: MobileTab; icon: string; label: string; badge: number | null }[] = [
    { key: "floor",  icon: "🪑",  label: "Tables", badge: null },
    { key: "menu",   icon: "🍽️", label: "Menu",   badge: unsentCount > 0 ? unsentCount : null },
    { key: "order",  icon: "📋",  label: "Order",  badge: cartCount > 0 ? cartCount : null },
  ];

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">

      {/* ── Top Bar ── */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface border-b border-border flex-shrink-0 gap-3">

        {/* Brand */}
        <div className="flex items-center gap-2.5 min-w-0">
          {brand && (brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} className="h-10 w-10 rounded-lg object-cover flex-shrink-0" />
          ) : (
            <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg bg-foreground text-sm font-bold text-background">{initials(brand.name)}</span>
          ))}
          <div className="flex flex-col leading-none gap-0.5">
            <span style={{ fontFamily: "var(--font-cinzel)" }} className="text-foreground font-bold text-sm lg:text-[15px] tracking-wide leading-none">
              {brand?.name ?? ""}
            </span>
            {brand?.tagline && (
              <span style={{ fontFamily: "var(--font-playfair)" }} className="text-yellow-600 text-[11px] font-bold italic tracking-widest leading-none">
                {brand.tagline}
              </span>
            )}
          </div>
          {breakfastTime && (
            <span className="hidden sm:inline bg-yellow-500 text-gray-900 text-xs font-bold px-2 py-0.5 rounded-full">BREAKFAST</span>
          )}
        </div>

        {/* Right side — clock + nav */}
        <div className="flex items-center gap-2 lg:gap-3 flex-shrink-0">
          <span className="text-foreground font-mono text-lg lg:text-xl font-bold tabular-nums">{timeStr}</span>

          {/* Desktop nav */}
          <div className="hidden lg:flex items-center gap-1.5">
            {session && (
              <div className="flex items-center gap-1.5 mr-1 px-2.5 py-1.5 bg-surface-hover/60 border border-border rounded-lg">
                <span className="text-foreground text-xs font-semibold">{session.name}</span>
                <span className="text-[10px] text-muted-foreground bg-elevated px-1.5 py-0.5 rounded">{roleLabel(session.role)}</span>
              </div>
            )}
            {session && session.role !== "employee" && (
              <button onClick={() => router.push("/staff")}
                className="px-3 py-1.5 bg-surface-hover hover:bg-elevated text-foreground text-xs font-semibold rounded-lg border border-border transition-colors">
                👥 Staff Hub
              </button>
            )}
            <button onClick={() => router.push("/pos/kitchen")}
              className="px-3 py-1.5 bg-surface-hover hover:bg-elevated text-foreground text-xs font-semibold rounded-lg border border-border transition-colors">
              🍳 Kitchen
            </button>
            <button onClick={() => router.push("/pos/history")}
              className="px-3 py-1.5 bg-surface-hover hover:bg-elevated text-foreground text-xs font-semibold rounded-lg border border-border transition-colors">
              📜 History
            </button>
            <button onClick={() => setShowCashOutModal(true)}
              className="px-3 py-1.5 bg-surface-hover hover:bg-elevated text-foreground text-xs font-semibold rounded-lg border border-border transition-colors">
              💵 Cash Out
            </button>
            <button
              onClick={() => {
                localStorage.setItem("pos_reservations_last_seen", new Date().toISOString());
                setReservationBadge(0);
                router.push("/pos/reservations");
              }}
              className="relative px-3 py-1.5 bg-surface-hover hover:bg-elevated text-foreground text-xs font-semibold rounded-lg border border-border transition-colors">
              📅 Reservations
              {reservationBadge > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
                  {reservationBadge}
                </span>
              )}
            </button>
            <button onClick={openEndOfDay}
              className="px-3 py-1.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 text-xs font-semibold rounded-lg border border-indigo-300 transition-colors">
              🌙 End of Day
            </button>
          </div>

          {/* Online ordering (busy mode) — every screen size, just before Logout */}
          <BusyModeControl />
          <button onClick={handleLogout}
            className="hidden lg:block px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold rounded-lg border border-red-300 transition-colors">
            Logout
          </button>

          {/* Mobile: More menu (with logout) */}
          <div className="relative lg:hidden">
            <button onClick={() => setShowMobileMenu((v) => !v)}
              className="px-2.5 py-1.5 bg-surface-hover hover:bg-elevated text-foreground text-xs font-semibold rounded-lg border border-border transition-colors">
              ☰ More
            </button>
            {showMobileMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMobileMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-surface border border-border rounded-lg shadow-xl overflow-hidden">
                  {session && (
                    <div className="px-3 py-2 border-b border-border">
                      <p className="text-foreground text-xs font-semibold">{session.name}</p>
                      <p className="text-muted-foreground text-[10px]">{roleLabel(session.role)}</p>
                    </div>
                  )}
                  {session && session.role !== "employee" && (
                    <button onClick={() => { setShowMobileMenu(false); router.push("/staff"); }}
                      className="w-full text-left px-3 py-2 text-foreground text-xs font-semibold hover:bg-surface-hover">
                      👥 Staff Hub
                    </button>
                  )}
                  <button onClick={() => { setShowMobileMenu(false); router.push("/pos/kitchen"); }}
                    className="w-full text-left px-3 py-2 text-foreground text-xs font-semibold hover:bg-surface-hover">
                    🍳 Kitchen
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); router.push("/pos/history"); }}
                    className="w-full text-left px-3 py-2 text-foreground text-xs font-semibold hover:bg-surface-hover">
                    📜 History
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); setShowCashOutModal(true); }}
                    className="w-full text-left px-3 py-2 text-foreground text-xs font-semibold hover:bg-surface-hover">
                    💵 Cash Out
                  </button>
                  <button
                    onClick={() => {
                      localStorage.setItem("pos_reservations_last_seen", new Date().toISOString());
                      setReservationBadge(0);
                      setShowMobileMenu(false);
                      router.push("/pos/reservations");
                    }}
                    className="relative w-full text-left px-3 py-2 text-foreground text-xs font-semibold hover:bg-surface-hover">
                    📅 Reservations
                    {reservationBadge > 0 && (
                      <span className="absolute top-1 right-3 bg-red-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
                        {reservationBadge}
                      </span>
                    )}
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); openEndOfDay(); }}
                    className="w-full text-left px-3 py-2 text-indigo-700 text-xs font-semibold hover:bg-surface-hover">
                    🌙 End of Day
                  </button>
                  <button onClick={handleLogout}
                    className="w-full text-left px-3 py-2 text-red-700 text-xs font-semibold hover:bg-surface-hover border-t border-border">
                    Logout
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <CloseDayReminder openedAt={tillPeriod?.opened_at ?? null} onCloseDay={openEndOfDay} />
      <TableRequestsBanner />

      {/* ══════════════════════════════════════════
          DESKTOP LAYOUT  (lg = 1024px and above)
      ══════════════════════════════════════════ */}
      <div className="hidden lg:flex flex-1 overflow-hidden">

        {/* Left Panel */}
        <div className="w-[360px] flex-shrink-0 flex flex-col border-r border-border/60 bg-surface overflow-hidden">

          <div className="px-3 pt-3 pb-2 flex-shrink-0">
            <OrderTypeSelector value={orderType} onChange={handleOrderTypeChange} onlineBadge={onlineBadge} />
          </div>

          {orderType === "online" && (
            <div className="flex-1 overflow-y-auto px-3 pb-3 min-h-0">
              <div className="mb-2 pt-1">
                <span className="text-[11px] font-bold text-muted-foreground tracking-widest uppercase">Online Orders</span>
              </div>
              <OnlineOrdersPanel />
            </div>
          )}

          {orderType !== "online" && orderType === "dine_in" && !selectedTable && (
            <div className="px-3 pb-3 flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-muted-foreground tracking-widest uppercase">Select a Table</span>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"/>Free</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block"/>Busy</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"/>Rsv</span>
                </div>
              </div>
              <TableGrid tables={tables} selectedTable={selectedTable} onSelect={handleTableSelect} onStatusChange={handleTableStatusChange} upcomingReservationCount={upcomingReservationCount} />
              {cartCount > 0 ? (
                <div className="mt-3 flex items-center gap-2 bg-amber-500/10 border border-amber-500/40 rounded-xl px-3 py-2.5 animate-pulse">
                  <span className="text-amber-600 text-base">⚠️</span>
                  <div>
                    <p className="text-amber-700 text-xs font-bold">{cartCount} item{cartCount > 1 ? "s" : ""} added — select a table</p>
                    <p className="text-amber-500/70 text-[10px]">Tap a table above to assign this order</p>
                  </div>
                </div>
              ) : (
                <p className="text-center text-muted-foreground text-[11px] mt-1.5">Tap a table to start an order</p>
              )}
            </div>
          )}

          {orderType !== "online" && orderType === "dine_in" && selectedTable && (
            <div className="mx-3 mb-3 flex-shrink-0">
              {tableHeader}
            </div>
          )}

          {(orderType === "takeaway" || orderType === "delivery") && customerDetailsCollected && (
            <div className="px-3 pb-3 flex-shrink-0">
              <div className="flex items-center justify-between gap-2 bg-surface-hover/60 border border-border rounded-xl px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-foreground text-sm font-semibold truncate">{customerName || "Guest"}</p>
                  <p className="text-muted-foreground text-xs truncate">
                    {customerPhone || "No phone"}{orderType === "delivery" && customerAddress ? ` · ${customerAddress}` : ""}
                  </p>
                </div>
                <button onClick={() => setShowCustomerPopup(true)} className="text-[11px] font-bold text-red-600 hover:underline flex-shrink-0">Edit</button>
              </div>
            </div>
          )}

          {(orderType === "takeaway" || orderType === "delivery") && cartItems.length === 0 && (
            <div className="flex-1 overflow-y-auto min-h-0 px-3 pb-3">
              <div className="mb-2 pt-1">
                <span className="text-[11px] font-bold text-muted-foreground tracking-widest uppercase">
                  Open {orderType === "delivery" ? "Delivery" : "Takeaway"} Orders
                </span>
              </div>
              <OpenOrdersPanel orderType={orderType} />
            </div>
          )}

          {orderType !== "online" && (selectedTable || orderType !== "dine_in") &&
            !((orderType === "takeaway" || orderType === "delivery") && cartItems.length === 0) && (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0 px-3">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <span className="text-[11px] font-bold text-muted-foreground tracking-widest uppercase">Order Items</span>
                {cartItems.length > 0 && (
                  <span className="text-[10px] bg-red-500/20 text-red-700 border border-red-500/30 rounded-full px-2 py-0.5 font-semibold">
                    {cartCount} items
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-hidden min-h-0 h-full">
                <OrderTicket
                  items={cartItems}
                  onUpdateQty={handleUpdateQty}
                  onRemove={handleRemoveItem}
                  onVoid={handleVoidItem}
                />
              </div>
            </div>
          )}

          {/* Discount controls — manager only */}
          {cartItems.length > 0 && (
            <div className="px-3 pt-1 flex-shrink-0">
              {isManager ? (
                <>
                  {discount > 0 && (
                    <div className="flex items-center justify-between bg-yellow-100 border border-yellow-300/40 rounded-lg px-3 py-1.5 text-xs">
                      <span className="text-yellow-700 font-semibold">Discount: -{formatCurrency(discount)}</span>
                      <button onClick={() => handleSetDiscount(0, "")} className="text-muted-foreground hover:text-red-600 text-[10px]">✕ Remove</button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 bg-surface-hover/60 border border-border rounded-lg px-3 py-1.5">
                  <span className="text-muted-foreground text-xs">🔒</span>
                  <span className="text-muted-foreground text-xs">Discounts — Manager only</span>
                </div>
              )}
            </div>
          )}

          {actionButtons}
        </div>

        {/* Right Panel - Menu (hidden for online orders) */}
        {orderType !== "online" && (
          <div className="flex-1 overflow-hidden flex flex-col p-3">
            <MenuPanel
              categories={categories}
              items={items}
              onAddItem={handleAddItem}
              layout="horizontal"
              orderType={orderType}
              disableAdd={orderType === "dine_in" && !selectedTable}
              onBlockedAdd={() => setShowTablePopup(true)}
            />
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════
          MOBILE / TABLET LAYOUT  (below lg)
      ══════════════════════════════════════════ */}
      <div className="flex lg:hidden flex-1 flex-col overflow-hidden">

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden">

          {/* ── Floor Tab ── */}
          {mobileTab === "floor" && (
            <div className="h-full overflow-y-auto">
              <div className="p-3 space-y-3">
                <OrderTypeSelector value={orderType} onChange={handleOrderTypeChange} onlineBadge={onlineBadge} />

                {orderType === "online" && (
                  <OnlineOrdersPanel />
                )}

                {orderType !== "online" && orderType === "dine_in" && !selectedTable && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-muted-foreground tracking-widest uppercase">Select a Table</span>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"/>Free</span>
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block"/>Busy</span>
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"/>Rsv</span>
                      </div>
                    </div>
                    <TableGrid tables={tables} selectedTable={selectedTable} onSelect={handleTableSelect} onStatusChange={handleTableStatusChange} upcomingReservationCount={upcomingReservationCount} />
                    {cartCount > 0 ? (
                      <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/40 rounded-xl px-3 py-2.5 animate-pulse">
                        <span className="text-amber-600 text-base">⚠️</span>
                        <div>
                          <p className="text-amber-700 text-xs font-bold">{cartCount} item{cartCount > 1 ? "s" : ""} added — select a table</p>
                          <p className="text-amber-500/70 text-[10px]">Tap a table above to assign this order</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-center text-muted-foreground text-[11px]">Tap a table to start an order</p>
                    )}
                  </>
                )}

                {orderType !== "online" && orderType === "dine_in" && selectedTable && (
                  <>
                    {tableHeader}
                    <button onClick={() => setMobileTab("menu")}
                      className="w-full py-3 bg-red-600/20 border border-red-500/30 text-red-700 font-semibold rounded-xl text-sm no-select pos-btn">
                      🍽️ Browse Menu →
                    </button>
                    <button onClick={() => setMobileTab("order")}
                      className="w-full py-3 bg-surface-hover border border-border text-foreground font-semibold rounded-xl text-sm no-select pos-btn">
                      📋 View Order{cartCount > 0 ? ` (${cartCount} items)` : ""}
                    </button>
                  </>
                )}

                {(orderType === "takeaway" || orderType === "delivery") && (
                  <div className="space-y-2">
                    {customerDetailsCollected && (
                      <div className="flex items-center justify-between gap-2 bg-surface-hover/60 border border-border rounded-xl px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-foreground text-sm font-semibold truncate">{customerName || "Guest"}</p>
                          <p className="text-muted-foreground text-xs truncate">
                            {customerPhone || "No phone"}{orderType === "delivery" && customerAddress ? ` · ${customerAddress}` : ""}
                          </p>
                        </div>
                        <button onClick={() => setShowCustomerPopup(true)} className="text-[11px] font-bold text-red-600 hover:underline flex-shrink-0">Edit</button>
                      </div>
                    )}
                    {cartItems.length === 0 ? (
                      <>
                        <div>
                          <span className="text-[11px] font-bold text-muted-foreground tracking-widest uppercase">
                            Open {orderType === "delivery" ? "Delivery" : "Takeaway"} Orders
                          </span>
                        </div>
                        <OpenOrdersPanel orderType={orderType} />
                      </>
                    ) : (
                      <p className="text-center text-muted-foreground text-xs">
                        {orderType === "delivery" ? "Delivery" : "Takeaway"} orders don&apos;t use tables — customer details are asked for when you send or pay.
                      </p>
                    )}
                    <button onClick={() => setMobileTab("menu")}
                      className="w-full py-3 bg-red-600/20 border border-red-500/30 text-red-700 font-semibold rounded-xl text-sm no-select pos-btn">
                      🍽️ Browse Menu →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Menu Tab ── */}
          {mobileTab === "menu" && (
            <div className="h-full flex flex-col overflow-hidden p-2 gap-2">
              {orderType === "dine_in" && !selectedTable && (
                <div className="flex-shrink-0 flex items-center gap-2 bg-amber-500/10 border border-amber-500/40 rounded-xl px-3 py-2">
                  <span className="text-amber-600">⚠️</span>
                  <p className="text-amber-700 text-xs font-bold flex-1">No table selected — go to Tables tab first</p>
                  <button onClick={() => setMobileTab("floor")}
                    className="text-[10px] font-bold text-amber-600 bg-amber-500/20 border border-amber-500/30 px-2 py-1 rounded-lg no-select">
                    → Tables
                  </button>
                </div>
              )}
              <div className="flex-1 overflow-hidden min-h-0">
                <MenuPanel
                  categories={categories}
                  items={items}
                  onAddItem={handleAddItem}
                  layout="horizontal"
                  orderType={orderType}
                  disableAdd={orderType === "dine_in" && !selectedTable}
                  onBlockedAdd={() => setShowTablePopup(true)}
                />
              </div>
            </div>
          )}

          {/* ── Order Tab ── */}
          {mobileTab === "order" && (
            <div className="h-full flex flex-col overflow-hidden">
              {orderType === "dine_in" && selectedTable && (
                <div className="px-3 pt-3 pb-2 flex-shrink-0">
                  {tableHeader}
                </div>
              )}
              {(orderType === "takeaway" || orderType === "delivery") && customerDetailsCollected && (
                <div className="px-3 pt-3 pb-2 flex-shrink-0">
                  <div className="flex items-center justify-between gap-2 bg-surface-hover/60 rounded-xl px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="text-muted-foreground">Customer: </span>
                      <span className="text-foreground font-semibold">{customerName || "Guest"}</span>
                      {customerPhone && <span className="text-muted-foreground"> · {customerPhone}</span>}
                    </div>
                    <button onClick={() => setShowCustomerPopup(true)} className="text-[11px] font-bold text-red-600 hover:underline flex-shrink-0">Edit</button>
                  </div>
                </div>
              )}
              <div className="px-3 pb-1 flex-shrink-0 flex items-center justify-between">
                <span className="text-[11px] font-bold text-muted-foreground tracking-widest uppercase">Order Items</span>
                {cartCount > 0 && (
                  <span className="text-[10px] bg-red-500/20 text-red-700 border border-red-500/30 rounded-full px-2 py-0.5 font-semibold">
                    {cartCount} items
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-hidden min-h-0 px-3">
                <OrderTicket
                  items={cartItems}
                  onUpdateQty={handleUpdateQty}
                  onRemove={handleRemoveItem}
                  onVoid={handleVoidItem}
                />
              </div>
              {/* Discount controls — manager only (mobile) */}
              {cartItems.length > 0 && (
                <div className="px-3 pt-1 flex-shrink-0">
                  {isManager ? (
                    <>
                      {happyHour && discount === 0 && (
                        <button onClick={() => handleSetDiscount(Math.round(subtotal * 0.1 * 100) / 100, "Happy Hour 10%")}
                          className="w-full py-1.5 bg-purple-100 border border-purple-300 rounded-lg text-purple-700 text-xs font-semibold hover:bg-purple-200 transition-colors no-select">
                          🎉 Happy Hour — tap to apply 10% off
                        </button>
                      )}
                      {discount > 0 && (
                        <div className="flex items-center justify-between bg-yellow-100 border border-yellow-300/40 rounded-lg px-3 py-1.5 text-xs">
                          <span className="text-yellow-700 font-semibold">Discount: -{formatCurrency(discount)}</span>
                          <button onClick={() => handleSetDiscount(0, "")} className="text-muted-foreground hover:text-red-600 text-[10px]">✕ Remove</button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 bg-surface-hover/60 border border-border rounded-lg px-3 py-1.5">
                      <span className="text-muted-foreground text-xs">🔒</span>
                      <span className="text-muted-foreground text-xs">Discounts — Manager only</span>
                    </div>
                  )}
                </div>
              )}
              {actionButtons}
            </div>
          )}
        </div>

        {/* Bottom Tab Bar */}
        <div className="flex-shrink-0 flex border-t border-border bg-surface">
          {mobileTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setMobileTab(tab.key)}
              className={`flex-1 relative flex flex-col items-center justify-center py-3 gap-0.5 transition-colors no-select ${
                mobileTab === tab.key
                  ? "text-red-600 border-t-2 border-red-400 -mt-[2px]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="text-xl leading-none">{tab.icon}</span>
              <span className="text-[10px] font-semibold">{tab.label}</span>
              {tab.badge !== null && (
                <span className="absolute top-1.5 right-[calc(50%-22px)] bg-red-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Status Toast — appears near the last tap/click */}
      {status && (
        <div
          className="fixed z-50 pointer-events-none transition-opacity"
          style={clickPos ? {
            left: Math.min(clickPos.x, window.innerWidth - 220),
            top: Math.max(clickPos.y - 52, 64),
          } : { top: 64, left: "50%", transform: "translateX(-50%)" }}
        >
          <div className="bg-surface border border-red-500/70 text-foreground text-xs font-semibold px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 whitespace-nowrap">
            <span className="text-red-600">⚠️</span>
            <span>{status}</span>
          </div>
        </div>
      )}

      {/* Table required popup — dine-in with no table selected yet */}
      {showTablePopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowTablePopup(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-3xl mb-2">🪑</div>
            <h2 className="text-foreground font-bold text-lg">Select a table first</h2>
            <p className="mt-1 text-sm text-muted-foreground">Dine-in orders need a table before you can add items.</p>
            <button
              onClick={() => { setShowTablePopup(false); setMobileTab("floor"); }}
              className="pos-btn no-select mt-5 w-full rounded-full bg-red-600 py-2.5 font-semibold text-white hover:bg-red-500"
            >
              OK, pick a table
            </button>
          </div>
        </div>
      )}

      {/* Cash Out — cash physically leaving the till mid-shift, so EOD's
          Expected Cash can subtract it back out */}
      {showCashOutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowCashOutModal(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="text-3xl mb-2">💵</div>
              <h2 className="text-foreground font-bold text-lg">Cash Out</h2>
              <p className="mt-1 text-sm text-muted-foreground">Record cash taken out of the till right now — a driver tip, petty cash, etc.</p>
            </div>
            <div className="mt-4 space-y-3">
              <input
                type="number" min="0" step="0.01" placeholder="Amount (£)"
                value={cashOutAmount} onChange={(e) => setCashOutAmount(e.target.value)}
                className="w-full bg-surface-hover border border-elevated text-foreground text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-red-500"
              />
              <input
                type="text" placeholder="Reason — e.g. paid delivery driver"
                value={cashOutReason} onChange={(e) => setCashOutReason(e.target.value)}
                className="w-full bg-surface-hover border border-elevated text-foreground text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-red-500"
              />
              {cashOutError && <p className="text-red-600 text-xs text-center">{cashOutError}</p>}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setShowCashOutModal(false); setCashOutAmount(""); setCashOutReason(""); setCashOutError(""); }}
                className="flex-1 h-11 bg-elevated hover:bg-elevated-hover border border-elevated text-foreground font-semibold rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCashOut}
                disabled={cashOutSaving}
                className="flex-1 h-11 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all"
              >
                {cashOutSaving ? "Saving…" : "Record"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer details popup — takeaway/delivery on Send to Kitchen or Pay; dine-in on Pay only */}
      {showCustomerPopup && (orderType === "takeaway" || orderType === "delivery" || orderType === "dine_in") && (
        <CustomerDetailsModal
          orderType={orderType}
          name={customerName}
          phone={customerPhone}
          address={customerAddress}
          email={customerEmail}
          marketingConsent={marketingConsent}
          onChangeName={setCustomerName}
          onChangePhone={setCustomerPhone}
          onChangeAddress={setCustomerAddress}
          onChangeEmail={setCustomerEmail}
          onChangeMarketingConsent={setMarketingConsent}
          onConfirm={handleCustomerDetailsConfirm}
          onClose={handleCustomerDetailsCancel}
        />
      )}

      {/* Payment Modal */}
      <PaymentModal
        open={paymentOpen}
        onClose={handlePaymentClose}
        orderId={currentOrderId}
        orderNumber={currentOrderNumber}
        customerId={currentCustomerId}
        onCustomerLinked={setCurrentCustomerId}
        extraOrderIds={allOrderIds.filter(id => id !== currentOrderId)}
        items={cartItems}
        subtotal={subtotal}
        discount={discount}
        tax={tax}
        total={total}
        amountPaid={currentAmountPaid}
        onPaymentComplete={handlePaymentComplete}
      />

      {/* End of Day Modal */}
      {endOfDayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="text-xl">🌙</span>
                <h2 className="text-foreground font-bold text-lg">End of Day</h2>
              </div>
              <button
                onClick={() => setEndOfDayOpen(false)}
                className="text-muted-foreground hover:text-foreground text-xl font-bold transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {eodError && (
                <div className="bg-red-50 border border-red-300 rounded-xl px-3 py-2.5 text-red-700 text-sm font-semibold">
                  ⚠ {eodError}
                </div>
              )}
              {eodLoading && !eodData ? (
                <div className="text-muted-foreground text-center py-6 animate-pulse">Loading summary...</div>
              ) : eodClosed ? (
                /* Success State */
                <div className="space-y-4">
                  <div className="text-center pt-2">
                    <div className="text-4xl mb-2">✅</div>
                    <p className="text-green-600 font-bold text-lg">Day Closed Successfully</p>
                    {/* The figures are pre-filled from this Z report (Staff Hub → Daily accounts). */}
                    <p className="mt-1 text-xs text-muted-foreground">Manager: fill in today&apos;s <b>Daily accounts</b> in the Staff Hub — the till figures are already there.</p>
                  </div>
                  {eodData && <ZReportView report={eodData} />}
                  <button
                    onClick={handlePrintEod}
                    disabled={!eodData}
                    className="w-full py-3 bg-elevated hover:bg-elevated-hover disabled:opacity-40 text-foreground font-bold rounded-xl transition-colors"
                  >
                    🖨️ Print Z Report
                  </button>
                  {eodPrintStatus && <p className="text-center text-xs font-semibold text-muted-foreground">{eodPrintStatus}</p>}
                  <button
                    onClick={handleLogout}
                    className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition-colors"
                  >
                    Log out now
                  </button>
                </div>
              ) : (
                /* Normal state */
                <>
                  {/* Unresolved orders — blocks Close Day entirely. Every order this
                      shift must be paid or explicitly marked Pay Later before you can
                      close; this is what's stopping you. */}
                  {(eodData?.other.unresolved.length || 0) > 0 && (
                    <div className="bg-red-500/10 border-2 border-red-500/50 rounded-xl px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-red-600">⛔</span>
                        <span className="text-red-700 text-xs font-bold">
                          Can't close yet — {eodData?.other.unresolved.length} order{(eodData?.other.unresolved.length || 0) > 1 ? "s" : ""} still need{(eodData?.other.unresolved.length || 0) > 1 ? "" : "s"} to be paid or marked Pay Later
                        </span>
                      </div>
                      <div className="space-y-1">
                        {eodData?.other.unresolved.map((o) => (
                          <div key={o.order_number} className="flex items-center justify-between text-[11px] text-red-800">
                            <span>{o.order_number}</span>
                            <span className="font-semibold">£{o.balance.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* The report exactly as it will print — Counted/Difference follow
                      the closing cash typed in below. */}
                  {eodData ? (
                    <ZReportView report={eodData} counted={eodClosingCash === "" ? null : parseFloat(eodClosingCash) || 0} />
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      The till wasn&apos;t opened today — closing will record today&apos;s orders as one shift.
                    </p>
                  )}

                  {/* Closing Cash Input */}
                  <div>
                    <label className="block text-muted-foreground text-xs font-semibold mb-1.5">
                      Closing Cash Count (£)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={eodClosingCash}
                      onChange={(e) => setEodClosingCash(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-surface-hover border border-border text-foreground rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red-500"
                    />
                    {eodClosingCash && eodData && (
                      <p className={`mt-1.5 text-xs font-semibold ${Math.abs(parseFloat(eodClosingCash) - eodData.cash.expected) < 0.01 ? "text-green-600" : "text-amber-600"}`}>
                        Expected £{eodData.cash.expected.toFixed(2)} · Difference £{(parseFloat(eodClosingCash) - eodData.cash.expected).toFixed(2)}
                      </p>
                    )}
                  </div>

                  {/* Comment — free text saved on the closed work_period, shown on the
                      printed Z-report (e.g. "Monday", "quiet night, boiler issue"). */}
                  <div>
                    <label className="block text-muted-foreground text-xs font-semibold mb-1.5">
                      Comment (optional)
                    </label>
                    <input
                      type="text"
                      value={eodCloseNote}
                      onChange={(e) => setEodCloseNote(e.target.value)}
                      placeholder="e.g. Monday, quiet night"
                      className="w-full bg-surface-hover border border-border text-foreground rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={handlePrintEod}
                      disabled={!eodData}
                      className="py-3 bg-elevated hover:bg-elevated-hover disabled:opacity-40 text-foreground font-bold rounded-xl transition-colors text-sm"
                    >
                      🖨️ Print X Report
                    </button>
                    <button
                      onClick={handleCloseDay}
                      disabled={eodLoading || (eodData?.other.unresolved.length || 0) > 0}
                      title={(eodData?.other.unresolved.length || 0) > 0 ? "Resolve every unpaid order first" : undefined}
                      className="py-3 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm"
                    >
                      {eodLoading ? "Closing..." : "🔒 Close Day"}
                    </button>
                  </div>
                  {eodPrintStatus && <p className="text-center text-xs font-semibold text-muted-foreground">{eodPrintStatus}</p>}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Open Till gate ──
          No open work_period for today: block ordering until a float is
          counted in. Managers get an escape hatch so a bug in this check
          can never lock the whole team out mid-service. */}
      {tillChecked && !tillFetchFailed && !tillPeriod && !tillBypassed && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-sm mx-4 shadow-2xl">
            <div className="px-6 py-5 border-b border-border text-center">
              <div className="text-3xl mb-2">🔐</div>
              <h2 className="text-foreground font-bold text-lg">Till Closed</h2>
              <p className="text-muted-foreground text-xs mt-1">Count in the float to open the till and start taking orders.</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              {openTillError && (
                <div className="bg-red-50 border border-red-300 rounded-xl px-3 py-2.5 text-red-700 text-sm font-semibold">
                  ⚠ {openTillError}
                </div>
              )}
              <div>
                <label className="block text-muted-foreground text-xs font-semibold mb-1.5">
                  Opening Cash Float (£)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  autoFocus
                  value={openingCashInput}
                  onChange={(e) => setOpeningCashInput(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-surface-hover border border-border text-foreground rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red-500"
                />
              </div>
              <button
                onClick={handleOpenTill}
                disabled={openTillLoading}
                className="w-full py-3 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm"
              >
                {openTillLoading ? "Opening…" : "🔓 Open Till"}
              </button>
              {isManager && (
                <button
                  onClick={() => setTillBypassed(true)}
                  className="w-full text-center text-muted-foreground hover:text-foreground text-xs font-semibold underline underline-offset-2"
                >
                  Continue without opening (manager)
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
