"use client";

import { useEffect, useRef, useState } from "react";
import { useBrand } from "@/components/pos/useBrand";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import type { CartItem } from "@/lib/types";
import PrintButton from "@/components/pos/PrintButton";
import MemberPanel from "@/components/pos/MemberPanel";

interface Props {
  open: boolean;
  onClose: () => void;
  orderId: number | null;
  orderNumber: string;
  customerId?: number | null;
  /** a member was put on the bill from the payment screen */
  onCustomerLinked?: (customerId: number) => void;
  extraOrderIds: number[];
  items: CartItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  // Amount already paid toward this order from an earlier session (e.g. a
  // partial cash payment made, then the modal was closed and reopened later)
  // — without this, remainingBalance below has no way to know a payment
  // already happened and re-offers the full bill as if nothing was paid.
  amountPaid?: number;
  onPaymentComplete: (remainingBalance?: number) => void;
}

type PayStep = "method" | "cash_amount" | "card_confirm" | "partial" | "receipt" | "pay_later_confirm" | "pay_later_done";

// £999,999.99 — comfortably beyond any real payment amount, safely below
// Number.MAX_SAFE_INTEGER even after a further *10, so no money entry field
// can overflow into float-precision or wraparound territory.
const MAX_MONEY_CENTS = 99999999;

// Implied-decimal, cents-based money entry for a compact inline field — the
// same concept as Cash Received's numpad (value only ever divides by 100 for
// display, never a parsed float), but typed into a normal text box instead
// of a dedicated numpad. Every non-digit character (typed "." included) is
// stripped, so digits always build the value from the right the way a real
// till does; the cursor is pinned to the end so a mid-string tap can't leave
// typing "stuck" partway through the number.
function MoneyCentsInput({
  cents,
  onChange,
  maxCents = MAX_MONEY_CENTS,
  placeholder = "0.00",
  disabled,
  className,
}: {
  cents: number;
  onChange: (cents: number) => void;
  maxCents?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const display = cents === 0 ? "" : (cents / 100).toFixed(2);

  useEffect(() => {
    const el = inputRef.current;
    if (el && document.activeElement === el) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [display]);

  const pinCursorToEnd = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    el.setSelectionRange(el.value.length, el.value.length);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={display}
      disabled={disabled}
      onFocus={pinCursorToEnd}
      onClick={pinCursorToEnd}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        onChange(digits === "" ? 0 : Math.min(maxCents, parseInt(digits, 10)));
      }}
      className={className}
    />
  );
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;

export default function PaymentModal({
  open,
  onClose,
  orderId,
  orderNumber,
  customerId: customerIdProp,
  onCustomerLinked,
  extraOrderIds,
  items,
  subtotal,
  discount,
  tax,
  total,
  amountPaid = 0,
  onPaymentComplete,
}: Props) {
  // This business's name / address for the receipt (each business is independent).
  const brand = useBrand();
  // A member added from this screen (🎁 panel) until the parent catches up.
  const [linkedCustomerId, setLinkedCustomerId] = useState<number | null>(null);
  useEffect(() => { setLinkedCustomerId(null); }, [open, orderId]);
  const customerId = customerIdProp ?? linkedCustomerId;
  const [step, setStep] = useState<PayStep>("method");
  const [method, setMethod] = useState<"cash" | "card" | null>(null);
  // Cash Received is entered like a cash register: each keypress appends a
  // digit on the right (value = value * 10 + digit), so the value is always
  // an exact integer number of pence — never a parsed float — until it's
  // divided by 100 for display.
  const [cashCents, setCashCents] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payLaterNote, setPayLaterNote] = useState("");
  const { toast } = useToast();

  // Discount state — overrides props once applied. Fixed (£) amount is
  // implied-decimal/cents-based like Cash Received; percent stays a plain
  // number input since it isn't a currency value.
  const [discountAmountCents, setDiscountAmountCents] = useState(0);
  const [discountPctInput, setDiscountPctInput] = useState("");
  const [discountType, setDiscountType] = useState<"fixed" | "pct">("fixed");
  const [discountReasonInput, setDiscountReasonInput] = useState("");
  // Who's giving a manual discount — the till is one shared login, so staff
  // pick their name; saved on the order (Order History + here), not the Z report.
  const [staffNames, setStaffNames] = useState<{ id: number; name: string }[]>([]);
  const [discountGiverId, setDiscountGiverId] = useState("");
  const [discountGivenBy, setDiscountGivenBy] = useState<string | null>(null);
  const [localDiscount, setLocalDiscount] = useState(discount);
  // Loyalty (voucher code or points) — its own line, on top of any discount.
  const [localLoyalty, setLocalLoyalty] = useState(0);
  const [localTax, setLocalTax] = useState(tax);
  const [localTotal, setLocalTotal] = useState(total);
  const [discountApplying, setDiscountApplying] = useState(false);

  // Loyalty balance/earn preview — shown whenever this order is linked to a
  // customer. Both numbers are real (same calc the actual award uses), not
  // guesses, so they never disagree with what posts once payment completes.
  const [loyaltyPreview, setLoyaltyPreview] = useState<{
    customerName: string; currentBalance: number; willEarn: number; tierName: string | null;
    cashCredit: { cap: number; step: number; convertedValue: number; eligible: boolean; options: number[]; redeemAmount: number } | null;
    doubleDay: string | null;
    visitNumber: number;
    visitBonus: number;
    /** points/vouchers can be spent on this bill (dine-in only) */
    canSpend: boolean;
    /** any reward needs the food bill (before it) to be at least this */
    minSpend: number;
  } | null>(null);
  const [cashCreditApplying, setCashCreditApplying] = useState(false);
  const [cashCreditApplied, setCashCreditApplied] = useState<number | null>(null);

  // Loyalty reward redemption — staff enter a code issued earlier from the
  // Customers & Loyalty screen; a successful redeem may adjust the discount.
  const [rewardCodeInput, setRewardCodeInput] = useState("");
  const [rewardApplying, setRewardApplying] = useState(false);
  const [rewardError, setRewardError] = useState("");
  const [appliedReward, setAppliedReward] = useState<string | null>(null);

  // Service charge
  const [serviceChargeInput, setServiceChargeInput] = useState("");
  const [localServiceCharge, setLocalServiceCharge] = useState(0);
  const [serviceChargeApplying, setServiceChargeApplying] = useState(false);

  // Split bill + tip + running balance across multiple payments on the same order.
  // remainingBalance is deliberately DERIVED (localTotal - amountPaidSoFar)
  // rather than its own state — every bill-editing handler below (discount,
  // service charge, reward, cash credit) only ever needs to update localTotal;
  // remainingBalance then follows automatically instead of each handler having
  // to remember to also recompute it against whatever was already paid.
  const [amountPaidSoFar, setAmountPaidSoFar] = useState(amountPaid);
  const remainingBalance = Math.max(0, Math.round((localTotal - amountPaidSoFar) * 100) / 100);
  const [splitCount, setSplitCount] = useState(1);
  const [tipCents, setTipCents] = useState(0);
  const [lastPaymentAmount, setLastPaymentAmount] = useState(0);
  // Cash given/change for the receipt screen — captured at confirm time since
  // cashCents resets to 0 right after (see handleProcessPayment), which would
  // otherwise make the receipt always show "Cash given £0.00".
  const [lastCashGiven, setLastCashGiven] = useState(0);
  const [lastChange, setLastChange] = useState(0);
  // Lets the cashier charge an arbitrary amount for this round instead of an
  // even split — e.g. "customer has £15 cash, put the rest on card". Null
  // means "use the even split"; sits between rounds so each partial payment
  // starts back at the full remaining/split amount. Implied-decimal cents,
  // same concept as Cash Received, once the cashier actually types a value.
  const [amountOverrideCents, setAmountOverrideCents] = useState<number | null>(null);

  // Till card reader (SumUp Solo or Stripe Terminal, per Settings) — falls
  // back to the manual "Card Paid" button below if no reader is configured.
  const [readerEnabled, setReaderEnabled] = useState(false);
  const [terminalStatus, setTerminalStatus] = useState<"idle" | "processing" | "failed">("idle");
  const [terminalError, setTerminalError] = useState("");
  // The charge the polling loop is currently watching. Cancel clears it so
  // the loop stops — otherwise a card that goes through after Cancel would be
  // recorded twice (by the loop and by Cancel's final check).
  const activeChargeRef = useRef<string | null>(null);
  const [useManualCard, setUseManualCard] = useState(false);

  useEffect(() => {
    fetch("/api/staff-names").then((r) => r.json()).then((d) => setStaffNames(d.staff || [])).catch(() => setStaffNames([]));
  }, []);

  useEffect(() => {
    fetch("/api/pos/terminal/config").then((r) => r.json()).then((d) => setReaderEnabled(!!d.enabled)).catch(() => setReaderEnabled(false));
  }, []);

  // Reset everything whenever the modal opens for a (possibly new) order.
  useEffect(() => {
    if (open) {
      setStep("method");
      setMethod(null);
      setCashCents(0);
      setError("");
      setDiscountAmountCents(0);
      setDiscountPctInput("");
      setDiscountType("fixed");
      setDiscountReasonInput("");
      setDiscountGiverId("");
      setDiscountGivenBy(null);
      // Pre-select whoever is signed in at the till (their PIN) as the giver.
      fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.user?.id) setDiscountGiverId(String(d.user.id)); }).catch(() => {});
      // The order may already carry a discount (show who gave it), loyalty or
      // a service charge from earlier.
      setLocalLoyalty(0);
      if (orderId) {
        fetch(`/api/orders/${orderId}`).then((r) => r.json()).then((d) => {
          const o = d.order;
          if (!o) return;
          setDiscountGivenBy(o.discount_given_by ?? null);
          setLocalLoyalty(Number(o.loyalty_discount) || 0);
          // A combined-table bill's totals come from the parent; this order alone would undercount.
          if (!extraOrderIds?.length) {
            setLocalDiscount(Number(o.discount) || 0);
            setLocalServiceCharge(Number(o.service_charge_amount) || 0);
            // The saved bill is the source of truth (loyalty isn't in the till's own sum).
            if (o.total != null) setLocalTotal(Number(o.total));
            if (o.tax != null) setLocalTax(Number(o.tax));
          }
        }).catch(() => {});
      }
      setLocalDiscount(discount);
      setLocalTax(tax);
      setLocalTotal(total);
      setServiceChargeInput("");
      setLocalServiceCharge(0);
      setAmountPaidSoFar(amountPaid);
      setSplitCount(1);
      setAmountOverrideCents(null);
      setTipCents(0);
      setTerminalStatus("idle");
      setTerminalError("");
      activeChargeRef.current = null;
      setUseManualCard(false);
      setPayLaterNote("");
      setRewardCodeInput("");
      setRewardError("");
      setAppliedReward(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  // Uses the live `total` prop, not the locally-managed `localTotal` copy —
  // localTotal only gets synced to `total` inside the reset effect above,
  // one render behind on a fresh open, which raced this fetch and showed a
  // stale (often zero) estimate. `total` itself is never stale. Re-fetches
  // if staff adjust the discount/service charge mid-modal too, since those
  // also update `localTotal`, which stays a reasonable proxy for "current
  // total" after that first render.
  useEffect(() => {
    if (!open || !customerId) { setLoyaltyPreview(null); return; }
    // Once anything has changed the bill (reward, points, discount), use its
    // current total — even £0, which earns nothing — not the original one.
    const amount = localLoyalty > 0 || cashCreditApplied !== null || appliedReward ? localTotal : localTotal || total;
    // Reopening a bill fires this twice (the till's total, then the saved
    // bill's): only the latest answer may land, or a stale one can win.
    let stale = false;
    fetch(`/api/loyalty/estimate?customer_id=${customerId}&amount=${amount}${orderId ? `&order_id=${orderId}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || stale) return;
        setLoyaltyPreview({
          customerName: d.customer_name,
          currentBalance: d.current_balance,
          willEarn: d.will_earn,
          tierName: d.tier_name,
          cashCredit: d.cash_credit ?? null,
          doubleDay: d.double_day ?? null,
          visitNumber: d.visit_number ?? 0,
          visitBonus: d.visit_bonus ?? 0,
          canSpend: d.can_spend !== false,
          minSpend: Number(d.reward_min_spend) || 0,
        });
      })
      .catch(() => {});
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerId, orderId, localTotal, total, localLoyalty]);

  useEffect(() => {
    if (open) { setCashCreditApplied(null); setCashCreditApplying(false); }
  }, [open, orderId]);

  const applyCashCredit = async (amount: number) => {
    if (!orderId || !customerId) return;
    setCashCreditApplying(true);
    setError("");
    try {
      const res = await fetch("/api/loyalty/redeem-cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId, order_id: orderId, amount }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Couldn't apply loyalty credit"); return; }
      setCashCreditApplied(data.amount);
      if (data.bill) {
        setLocalLoyalty(data.bill.loyalty ?? data.amount);
        setLocalTax(data.bill.tax ?? localTax);
        setLocalTotal(data.bill.total ?? localTotal);
      }
      toast({ variant: "success", title: "Loyalty credit applied", description: `£${data.amount.toFixed(2)} off` });
    } catch { setError("Couldn't apply loyalty credit"); }
    finally { setCashCreditApplying(false); }
  };

  const applyDiscount = async () => {
    if (!orderId) return;
    const raw = discountType === "fixed" ? discountAmountCents / 100 : parseFloat(discountPctInput) || 0;
    if (!raw) return;
    setDiscountApplying(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discount_type: discountType === "pct" ? "percent" : "amount",
          discount_value: raw,
          discount_reason: discountReasonInput || undefined,
          discount_given_by_staff_id: Number(discountGiverId),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to apply discount"); return; }
      if (data.order) {
        setLocalDiscount(data.order.discount ?? 0);
        setDiscountGivenBy(data.order.discount_given_by ?? null);
        setLocalTax(data.order.tax ?? localTax);
        setLocalTotal(data.order.total ?? localTotal);
        toast({ variant: "success", title: "Discount applied" });
      }
    } catch { setError("Failed to apply discount"); }
    finally { setDiscountApplying(false); }
  };

  const removeDiscount = async () => {
    if (!orderId) return;
    setDiscountApplying(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discount_type: null }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to remove discount"); return; }
      if (data.order) {
        setLocalDiscount(0);
        setLocalTax(data.order.tax ?? tax);
        setLocalTotal(data.order.total ?? total);
        setDiscountAmountCents(0);
        setDiscountPctInput("");
        setDiscountReasonInput("");
        setDiscountGivenBy(null);
      }
    } catch { setError("Failed to remove discount"); }
    finally { setDiscountApplying(false); }
  };

  const applyRewardCode = async () => {
    if (!orderId || !rewardCodeInput.trim()) return;
    setRewardApplying(true);
    setRewardError("");
    try {
      const res = await fetch("/api/loyalty/redemptions/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: rewardCodeInput.trim(), order_id: orderId }),
      });
      const data = await res.json();
      if (!res.ok) { setRewardError(data.message || data.error || "Couldn't redeem this code"); return; }
      setAppliedReward(data.reward_name);
      setRewardCodeInput("");
      if (data.bill) {
        setLocalLoyalty(data.bill.loyalty ?? localLoyalty);
        setLocalTax(data.bill.tax ?? localTax);
        setLocalTotal(data.bill.total ?? localTotal);
      }
      toast({ variant: "success", title: "Reward applied", description: data.reward_name });
    } catch { setRewardError("Couldn't redeem this code"); }
    finally { setRewardApplying(false); }
  };

  const applyServiceCharge = async (pct: number) => {
    if (!orderId) return;
    setServiceChargeApplying(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/service-charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pct }),
      });
      const data = await res.json();
      if (data.order) {
        setLocalServiceCharge(data.order.service_charge_amount ?? 0);
        setLocalTotal(data.order.total ?? localTotal);
      }
    } catch { /* silent */ }
    finally { setServiceChargeApplying(false); }
  };

  // What this specific payment transaction should collect — the full remaining
  // balance, or an equal share of it if the bill is being split N ways, unless
  // the cashier has typed a custom amount for a mixed cash/card tender.
  const splitAmount = Math.round((remainingBalance / Math.max(1, splitCount)) * 100) / 100;
  const amountDue = amountOverrideCents !== null
    ? Math.min(Math.max(0, amountOverrideCents / 100), remainingBalance)
    : splitAmount;
  const tipAmount = tipCents / 100;
  const cashAmount = cashCents / 100;
  const change = Math.max(0, cashAmount - amountDue - tipAmount);

  const handleClose = () => {
    onClose();
  };

  const handleCashDigit = (digit: number) => {
    setCashCents((prev) => Math.min(MAX_MONEY_CENTS, prev * 10 + digit));
  };

  const handleCashDoubleZero = () => {
    setCashCents((prev) => Math.min(MAX_MONEY_CENTS, prev * 100));
  };

  const handleCashBackspace = () => {
    setCashCents((prev) => Math.floor(prev / 10));
  };

  const handleCashClear = () => {
    setCashCents(0);
  };

  // A bill brought to £0 by a reward, points or a 100% discount: nothing to
  // take, so close it (marks it paid, frees the table, prints the receipt).
  const closeZeroBill = async () => {
    if (!orderId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}/close-zero`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Couldn't close the bill"); return; }
      setLastPaymentAmount(0);
      setAmountPaidSoFar(localTotal);
      setStep("receipt");
      // No balance passed: the till's own total doesn't include the reward,
      // so "0 left" would read as the full price "already paid".
      onPaymentComplete();
    } catch {
      setError("Couldn't close the bill. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleProcessPayment = async (reference?: string) => {
    if (!orderId) return;
    setLoading(true);
    setError("");
    try {
      const amount = method === "cash" ? Math.min(cashAmount - tipAmount, amountDue) : amountDue;
      const body: Record<string, unknown> = {
        method,
        amount,
        tip_amount: tipAmount,
        change_given: method === "cash" ? change : 0,
        reference: reference || undefined,
        extraOrderIds: extraOrderIds.length > 0 ? extraOrderIds : undefined,
      };

      const res = await fetch(`/api/orders/${orderId}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Payment failed");
        return;
      }

      if (data.unpaid_merged_orders?.length) {
        toast({ variant: "destructive", title: "Some merged orders weren't paid", description: "This bill was taken, but check the merged orders in Open Orders and settle them." });
      }
      setLastPaymentAmount(amount);
      // Derive amountPaidSoFar from the server's authoritative remaining
      // balance (localTotal - remaining) rather than setting remainingBalance
      // directly — it's the derived value now, see its declaration above.
      setAmountPaidSoFar(Math.max(0, Math.round((localTotal - (data.remaining_balance ?? 0)) * 100) / 100));
      if (method === "cash") {
        setLastCashGiven(cashAmount);
        setLastChange(change);
      }
      setTipCents(0);
      setCashCents(0);

      if (data.fully_paid) {
        setStep("receipt");
        onPaymentComplete(data.remaining_balance);
      } else {
        setStep("partial");
        onPaymentComplete(data.remaining_balance);
      }
    } catch {
      setError("Payment failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePayLater = async () => {
    if (!orderId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}/pay-later`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: payLaterNote || undefined,
          extraOrderIds: extraOrderIds.length > 0 ? extraOrderIds : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to mark pay later");
        return;
      }
      setStep("pay_later_done");
      onPaymentComplete();
    } catch {
      setError("Failed to mark pay later. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Pushes a real charge to the till's card reader (SumUp Solo or Stripe
  // Terminal) for the card leg of the bill (bill amount + tip in one real
  // transaction), then polls until the customer has tapped/inserted their
  // card. Only reached when a reader is actually configured — otherwise the
  // existing manual "Card Paid" button below handles a separate card machine.
  const checkTerminalCharge = async (chargeId: string) => {
    const res = await fetch(`/api/pos/terminal/status?charge_id=${encodeURIComponent(chargeId)}`);
    return res.json();
  };

  const startTerminalCharge = async () => {
    setTerminalStatus("processing");
    setTerminalError("");
    try {
      const chargeRes = await fetch("/api/pos/terminal/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amountDue + tipAmount, order_number: orderNumber || undefined }),
      });
      const chargeData = await chargeRes.json();
      if (!chargeRes.ok) {
        setTerminalStatus("failed");
        setTerminalError(chargeData.error || "Failed to start card reader payment");
        return;
      }
      const chargeId = chargeData.charge_id as string;
      activeChargeRef.current = chargeId;
      const stillActive = () => activeChargeRef.current === chargeId;

      const deadline = Date.now() + 90_000; // 90s — plenty for a tap, avoids hanging forever if the reader loses connection
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!stillActive()) return; // cancelled — Cancel does the final check
        const statusData = await checkTerminalCharge(chargeId);
        if (!stillActive()) return;
        if (statusData.status === "succeeded") {
          activeChargeRef.current = null;
          await handleProcessPayment(statusData.reference || chargeId);
          return;
        }
        if (statusData.status === "canceled") {
          setTerminalStatus("failed");
          setTerminalError("Payment was cancelled");
          return;
        }
        if (statusData.status === "requires_payment_method" && statusData.declined) {
          setTerminalStatus("failed");
          setTerminalError(statusData.error_message || "Card declined — please try again");
          return;
        }
        // requires_payment_method with no error yet just means "still waiting
        // for the customer to tap/insert" — keep polling.
      }
      if (!stillActive()) return;
      activeChargeRef.current = null;
      // Stop the reader so a late tap can't take money the till never records,
      // then look once more in case the card went through right at the end.
      await fetch("/api/pos/terminal/cancel", { method: "POST" }).catch(() => {});
      const last = await checkTerminalCharge(chargeId).catch(() => null);
      if (last?.status === "succeeded") {
        await handleProcessPayment(last.reference || chargeId);
        return;
      }
      setTerminalStatus("failed");
      setTerminalError("Timed out waiting for the card reader");
    } catch {
      setTerminalStatus("failed");
      setTerminalError("Lost connection to the card reader");
    }
  };

  const cancelTerminalCharge = async () => {
    const chargeId = activeChargeRef.current;
    activeChargeRef.current = null;
    setTerminalStatus("idle");
    if (!chargeId) return;
    await fetch("/api/pos/terminal/cancel", { method: "POST" }).catch(() => {});
    // The customer may have tapped a moment before Cancel — if the card was
    // charged anyway, record it rather than leave money unaccounted for.
    const last = await checkTerminalCharge(chargeId).catch(() => null);
    if (last?.status === "succeeded") await handleProcessPayment(last.reference || chargeId);
  };

  const quickAmounts = [
    Math.ceil(amountDue + tipAmount),
    Math.ceil((amountDue + tipAmount) / 5) * 5,
    Math.ceil((amountDue + tipAmount) / 10) * 10,
    Math.ceil((amountDue + tipAmount) / 20) * 20,
  ].filter((v, i, arr) => arr.indexOf(v) === i && v >= amountDue + tipAmount).slice(0, 4);

  const tipPresets = [0, 10, 12.5, 15].map((pct) => ({ pct, amount: Math.round(amountDue * (pct / 100) * 100) / 100 }));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-surface border-border max-w-md w-full">
        <DialogHeader>
          <DialogTitle className="text-foreground text-xl">
            {step === "receipt" ? "Payment Complete" : step === "partial" ? "Partial Payment Recorded" : step === "pay_later_done" ? "Pay Later" : "Payment"}
            {orderNumber && (
              <span className="text-red-600 text-sm font-normal ml-2">
                #{orderNumber}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Method Selection */}
        {step === "method" && (() => {
          // Merge same items (multiple rounds) by name+price, exclude voided
          const merged = items.filter(i => !i.voided).reduce<{ item_name: string; item_price: number; quantity: number; is_veg?: number }[]>((acc, item) => {
            const existing = acc.find(a => a.item_name === item.item_name && a.item_price === item.item_price);
            if (existing) { existing.quantity += item.quantity; }
            else { acc.push({ item_name: item.item_name, item_price: item.item_price, quantity: item.quantity, is_veg: item.is_veg }); }
            return acc;
          }, []);

          return (
            <div className="space-y-3">
              {/* Items list */}
              <div className="bg-surface-hover rounded-xl p-3 max-h-40 overflow-y-auto space-y-1.5">
                {merged.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className={item.is_veg ? "veg-dot flex-shrink-0" : "non-veg-dot flex-shrink-0"} />
                    <span className="flex-1 text-foreground text-sm">{item.item_name}</span>
                    <span className="text-muted-foreground text-sm font-bold w-6 text-center">{item.quantity}×</span>
                    <span className="text-foreground text-sm font-semibold min-w-[52px] text-right">{formatCurrency(item.item_price * item.quantity)}</span>
                  </div>
                ))}
                {merged.length === 0 && <p className="text-muted-foreground text-xs text-center py-2">No items</p>}
              </div>

              {/* Discount input */}
              <div className="bg-surface-hover/60 rounded-xl px-3 py-2.5 space-y-2">
                <div className="text-xs text-muted-foreground font-semibold">Apply Discount</div>
                <div className="flex gap-2">
                  <div className="flex rounded-lg overflow-hidden border border-elevated flex-shrink-0">
                    <button onClick={() => setDiscountType("fixed")}
                      className={`px-2.5 py-1.5 text-xs font-bold transition-all ${discountType === "fixed" ? "bg-red-600 text-white" : "bg-elevated text-muted-foreground"}`}>
                      £
                    </button>
                    <button onClick={() => setDiscountType("pct")}
                      className={`px-2.5 py-1.5 text-xs font-bold transition-all ${discountType === "pct" ? "bg-red-600 text-white" : "bg-elevated text-muted-foreground"}`}>
                      %
                    </button>
                  </div>
                  {discountType === "fixed" ? (
                    <MoneyCentsInput
                      cents={discountAmountCents}
                      onChange={setDiscountAmountCents}
                      className="flex-1 bg-elevated border border-elevated rounded-lg px-3 py-1.5 text-foreground text-sm focus:outline-none focus:border-red-500"
                    />
                  ) : (
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={discountPctInput}
                      onChange={e => setDiscountPctInput(e.target.value)}
                      className="flex-1 bg-elevated border border-elevated rounded-lg px-3 py-1.5 text-foreground text-sm focus:outline-none focus:border-red-500"
                    />
                  )}
                  <button
                    onClick={applyDiscount}
                    disabled={(discountType === "fixed" ? discountAmountCents === 0 : !discountPctInput) || !discountGiverId || discountApplying}
                    title={!discountGiverId ? "Choose who is giving the discount" : undefined}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-all"
                  >
                    {discountApplying ? "…" : "Apply"}
                  </button>
                  {localDiscount > 0 && (
                    <button onClick={removeDiscount} disabled={discountApplying}
                      className="px-2.5 py-1.5 bg-elevated hover:bg-red-200 border border-elevated hover:border-red-300 text-muted-foreground hover:text-red-600 text-xs font-bold rounded-lg transition-all">
                      ✕
                    </button>
                  )}
                </div>
                <select
                  value={discountGiverId}
                  onChange={(e) => setDiscountGiverId(e.target.value)}
                  className={`w-full bg-elevated border rounded-lg px-3 py-1.5 text-foreground text-xs focus:outline-none focus:border-red-500 ${discountGiverId ? "border-elevated" : "border-amber-400"}`}
                >
                  <option value="">Discount given by… (required)</option>
                  {staffNames.map((st) => (
                    <option key={st.id} value={st.id}>{st.name}</option>
                  ))}
                </select>
                {localDiscount > 0 && discountGivenBy && (
                  <div className="text-xs font-semibold text-emerald-700">
                    ✓ {formatCurrency(localDiscount)} discount given by {discountGivenBy}
                  </div>
                )}
                <input
                  type="text"
                  placeholder="Reason (optional) — e.g. goodwill, complaint, staff meal"
                  value={discountReasonInput}
                  onChange={e => setDiscountReasonInput(e.target.value)}
                  className="w-full bg-elevated border border-elevated rounded-lg px-3 py-1.5 text-foreground text-xs focus:outline-none focus:border-red-500"
                />
              </div>

              {/* Loyalty reward code */}
              <div className="bg-surface-hover/60 rounded-xl px-3 py-2.5 space-y-2">
                <div className="text-xs text-muted-foreground font-semibold">Loyalty Reward Code</div>
                {appliedReward ? (
                  <div className="text-emerald-600 text-xs font-semibold">✓ {appliedReward} applied</div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. 7K4M9PQ2"
                      value={rewardCodeInput}
                      onChange={(e) => setRewardCodeInput(e.target.value.toUpperCase())}
                      className="flex-1 bg-elevated border border-elevated rounded-lg px-3 py-1.5 text-foreground text-sm font-mono tracking-wider focus:outline-none focus:border-red-500"
                    />
                    <button
                      onClick={applyRewardCode}
                      disabled={!rewardCodeInput.trim() || rewardApplying}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-all"
                    >
                      {rewardApplying ? "…" : "Redeem"}
                    </button>
                  </div>
                )}
                {rewardError && <div className="text-red-600 text-xs">{rewardError}</div>}
                {!appliedReward && localLoyalty <= 0 && loyaltyPreview && loyaltyPreview.minSpend > 0 && subtotal < loyaltyPreview.minSpend - 0.005 && (
                  <div className="text-amber-700 text-[11px]">Rewards need a bill of {formatCurrency(loyaltyPreview.minSpend)} or more: this one is {formatCurrency(subtotal)}</div>
                )}
              </div>

              {/* Service charge */}
              <div className="bg-surface-hover/60 rounded-xl px-3 py-2.5 space-y-2">
                <div className="text-xs text-muted-foreground font-semibold">Service Charge</div>
                <div className="flex gap-2">
                  {[0, 10, 12.5].map((pct) => (
                    <button key={pct} onClick={() => applyServiceCharge(pct)} disabled={serviceChargeApplying}
                      className="flex-1 py-1.5 bg-elevated hover:bg-red-600 hover:text-white border border-elevated rounded-lg text-foreground text-xs font-bold transition-all disabled:opacity-40">
                      {pct === 0 ? "None" : `${pct}%`}
                    </button>
                  ))}
                  <input type="number" min="0" max="100" placeholder="Custom %" value={serviceChargeInput}
                    onChange={(e) => setServiceChargeInput(e.target.value)}
                    className="w-20 bg-elevated border border-elevated rounded-lg px-2 py-1.5 text-foreground text-xs focus:outline-none focus:border-red-500" />
                  <button onClick={() => applyServiceCharge(Number(serviceChargeInput) || 0)} disabled={!serviceChargeInput || serviceChargeApplying}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-all">
                    Set
                  </button>
                </div>
              </div>

              {/* Split bill */}
              <div className="bg-surface-hover/60 rounded-xl px-3 py-2.5 flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-semibold">Split Bill</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setSplitCount((n) => Math.max(1, n - 1)); setAmountOverrideCents(null); }} className="h-9 w-9 rounded-full bg-elevated border border-elevated text-foreground">−</button>
                  <span className="text-foreground text-sm w-16 text-center">{splitCount === 1 ? "Full bill" : `${splitCount} ways`}</span>
                  <button onClick={() => { setSplitCount((n) => n + 1); setAmountOverrideCents(null); }} className="h-9 w-9 rounded-full bg-elevated border border-elevated text-foreground">+</button>
                </div>
              </div>

              {/* Totals */}
              <div className="bg-surface-hover/60 rounded-xl px-4 py-3 space-y-1">
                <div className="flex justify-between text-muted-foreground text-xs">
                  <span>Subtotal</span><span>{formatCurrency(subtotal)}</span>
                </div>
                {localServiceCharge > 0 && (
                  <div className="flex justify-between text-purple-700 text-xs">
                    <span>Service Charge</span><span>{formatCurrency(localServiceCharge)}</span>
                  </div>
                )}
                {localDiscount > 0 && (
                  <div className="flex justify-between text-yellow-600 text-xs">
                    <span>Discount{discountGivenBy ? ` (${discountGivenBy})` : ""}</span><span>−{formatCurrency(localDiscount)}</span>
                  </div>
                )}
                {localLoyalty > 0 && (
                  <div className="flex justify-between text-rose-700 text-xs">
                    <span>Loyalty</span><span>−{formatCurrency(localLoyalty)}</span>
                  </div>
                )}
                <div className="flex justify-between text-foreground font-bold text-base border-t border-border pt-1.5 mt-1">
                  <span>Bill Total</span>
                  <span className="text-red-600 text-xl">{formatCurrency(localTotal)}</span>
                </div>
                <div className="text-right text-muted-foreground text-[10px]">incl. VAT {formatCurrency(localTax)}</div>
                {!customerId && orderId && (
                  <MemberPanel
                    orderIds={[orderId, ...extraOrderIds]}
                    onLinked={(m, joined) => {
                      setLinkedCustomerId(m.id);
                      onCustomerLinked?.(m.id);
                      toast({
                        variant: "success",
                        title: joined ? `${m.name} joined the Rewards Club` : `${m.name} added to this bill`,
                        description: joined ? "200 points now · 20% off their next dine-in visit" : `${m.loyalty_points} points`,
                      });
                    }}
                  />
                )}
                {loyaltyPreview && (
                  <div className="flex items-center justify-between bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 mt-1">
                    <span className="text-rose-800 text-[11px] font-medium truncate">🎁 {loyaltyPreview.customerName} · {loyaltyPreview.currentBalance} pts{loyaltyPreview.tierName ? ` · ${loyaltyPreview.tierName}` : ""}</span>
                    {loyaltyPreview.willEarn > 0 && (
                      <span className="text-rose-700 text-[11px] font-bold flex-shrink-0 ml-2">
                        +{loyaltyPreview.willEarn} this visit{loyaltyPreview.doubleDay ? ` (2× ${loyaltyPreview.doubleDay})` : ""}
                        {loyaltyPreview.visitBonus > 0 && ` incl. ${ordinal(loyaltyPreview.visitNumber)}-visit bonus`}
                      </span>
                    )}
                  </div>
                )}
                {cashCreditApplied !== null ? (
                  <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                    <span className="text-emerald-800 text-[11px] font-semibold">✓ Loyalty credit applied</span>
                    <span className="text-emerald-800 text-[11px] font-bold">−{formatCurrency(cashCreditApplied)}</span>
                  </div>
                ) : localLoyalty > 0 || appliedReward ? (
                  <p className="text-center text-muted-foreground text-[10px]">
                    A reward is already on this bill, so points can&apos;t be used too
                  </p>
                ) : loyaltyPreview && !loyaltyPreview.canSpend ? (
                  loyaltyPreview.cashCredit && loyaltyPreview.cashCredit.convertedValue > 0 ? (
                    <p className="text-center text-muted-foreground text-[10px]">
                      £{loyaltyPreview.cashCredit.convertedValue.toFixed(2)} of points banked — points can be used on dine-in only
                    </p>
                  ) : null
                ) : loyaltyPreview?.cashCredit?.eligible && subtotal < loyaltyPreview.minSpend - 0.005 ? (
                  <p className="text-center text-muted-foreground text-[10px]">
                    £{loyaltyPreview.cashCredit.convertedValue.toFixed(2)} of points banked: usable on bills of {formatCurrency(loyaltyPreview.minSpend)} or more
                  </p>
                ) : loyaltyPreview?.cashCredit?.eligible ? (
                  <div className="flex gap-1.5">
                    {loyaltyPreview.cashCredit.options.map((amt) => (
                      <button
                        key={amt}
                        onClick={() => applyCashCredit(amt)}
                        disabled={cashCreditApplying}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg px-2.5 py-2 transition-all"
                      >
                        {cashCreditApplying ? "Applying…" : `🎁 Use £${amt.toFixed(0)} of points`}
                      </button>
                    ))}
                  </div>
                ) : loyaltyPreview?.cashCredit && loyaltyPreview.cashCredit.convertedValue > 0 ? (
                  <p className="text-center text-muted-foreground text-[10px]">
                    £{loyaltyPreview.cashCredit.convertedValue.toFixed(2)} of points banked — usable from £{loyaltyPreview.cashCredit.step.toFixed(0)}
                  </p>
                ) : null}
                {remainingBalance < localTotal - 0.01 && (
                  <div className="flex justify-between text-emerald-600 text-xs">
                    <span>Already paid</span><span>{formatCurrency(localTotal - remainingBalance)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-foreground font-bold text-sm">
                  <span>{splitCount > 1 ? `This payment (1 of ${splitCount})` : "Amount Due"}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-red-600">£</span>
                    <MoneyCentsInput
                      cents={amountOverrideCents !== null ? amountOverrideCents : Math.round(amountDue * 100)}
                      onChange={setAmountOverrideCents}
                      maxCents={Math.round(remainingBalance * 100)}
                      className="w-20 bg-elevated border border-elevated rounded-lg px-2 py-1 text-red-600 text-sm font-bold text-right focus:outline-none focus:border-red-500"
                    />
                  </div>
                </div>
                <p className="text-muted-foreground text-[11px]">Edit to charge a different amount now — e.g. part cash, rest on card.</p>
              </div>

              {/* Tip */}
              <div className="bg-surface-hover/60 rounded-xl px-3 py-2.5 space-y-2">
                <div className="text-xs text-muted-foreground font-semibold">Add Tip</div>
                <div className="flex gap-2">
                  {tipPresets.map(({ pct, amount }) => {
                    const presetCents = Math.round(amount * 100);
                    return (
                      <button key={pct} onClick={() => setTipCents(presetCents)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${tipCents === presetCents ? "bg-red-600 border-red-500 text-white" : "bg-elevated border-elevated text-foreground"}`}>
                        {pct === 0 ? "None" : `${pct}%`}
                      </button>
                    );
                  })}
                  <MoneyCentsInput
                    cents={tipCents}
                    onChange={setTipCents}
                    placeholder="£ custom"
                    className="w-20 bg-elevated border border-elevated rounded-lg px-2 py-1.5 text-foreground text-xs focus:outline-none focus:border-red-500"
                  />
                </div>
              </div>

              {remainingBalance <= 0.009 && localTotal <= 0.009 ? (
                <div className="space-y-2">
                  <p className="text-center text-sm text-muted-foreground">Nothing to pay: the reward or discount covers the whole bill.</p>
                  <button onClick={closeZeroBill} disabled={loading}
                    className="pos-btn no-select w-full h-14 bg-green-600 hover:bg-green-500 disabled:opacity-60 text-white font-bold text-lg rounded-xl transition-all">
                    {loading ? "Closing…" : "✓ Close bill: nothing to pay"}
                  </button>
                </div>
              ) : (<>
              <div className="text-muted-foreground text-sm font-medium text-center">Select Payment Method</div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { setMethod("cash"); setStep("cash_amount"); }}
                  className="pos-btn no-select flex flex-col items-center gap-2 p-5 bg-green-100 hover:bg-green-200 border-2 border-green-300 rounded-xl text-green-700 transition-all">
                  <span className="text-3xl">💵</span>
                  <span className="font-bold text-lg">CASH</span>
                </button>
                <button onClick={() => { setMethod("card"); setStep("card_confirm"); }}
                  className="pos-btn no-select flex flex-col items-center gap-2 p-5 bg-blue-100 hover:bg-blue-200 border-2 border-blue-300 rounded-xl text-blue-700 transition-all">
                  <span className="text-3xl">💳</span>
                  <span className="font-bold text-lg">CARD</span>
                </button>
              </div>
              </>)}

              {!(remainingBalance <= 0.009 && localTotal <= 0.009) && (
                <button onClick={() => setStep("pay_later_confirm")}
                  className="pos-btn no-select w-full flex items-center justify-center gap-2 py-3 bg-amber-100 hover:bg-amber-200 border-2 border-amber-300 rounded-xl text-amber-700 transition-all">
                  <span className="text-xl">📌</span>
                  <span className="font-bold text-sm">PAY LATER — card declined / customer will return</span>
                </button>
              )}

              {error && <div className="text-red-600 text-sm text-center">{error}</div>}
            </div>
          );
        })()}

        {/* Cash Amount Entry */}
        {step === "cash_amount" && (
          <div className="space-y-4">
            <div className="bg-surface-hover rounded-xl p-4 flex justify-between items-center">
              <div>
                <div className="text-muted-foreground text-sm">To Pay{tipAmount > 0 && ` (+${formatCurrency(tipAmount)} tip)`}</div>
                <div className="text-red-600 text-2xl font-bold">
                  {formatCurrency(amountDue + tipAmount)}
                </div>
              </div>
              {cashAmount > 0 && (
                <div className="text-right">
                  <div className="text-muted-foreground text-sm">Change</div>
                  <div
                    className={`text-2xl font-bold ${change >= 0 ? "text-green-600" : "text-red-600"}`}
                  >
                    {formatCurrency(change)}
                  </div>
                </div>
              )}
            </div>

            {/* Cash amount display */}
            <div className="bg-surface-hover border border-elevated rounded-xl p-4 text-center relative">
              <div className="flex items-center justify-center gap-2">
                <div className="text-muted-foreground text-sm">Cash Received</div>
                <button
                  onClick={handleCashBackspace}
                  disabled={cashCents === 0}
                  aria-label="Backspace"
                  className="pos-btn no-select absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-elevated disabled:opacity-30 font-bold text-lg"
                >
                  ⌫
                </button>
              </div>
              <div className="text-foreground text-3xl font-mono font-bold">
                {formatCurrency(cashAmount)}
              </div>
            </div>

            {/* Quick amounts */}
            <div className="grid grid-cols-4 gap-2">
              {quickAmounts.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setCashCents(Math.min(MAX_MONEY_CENTS, Math.round(amt * 100)))}
                  className="pos-btn no-select py-2 bg-elevated hover:bg-elevated-hover border border-elevated rounded-lg text-foreground text-sm font-semibold"
                >
                  £{amt}
                </button>
              ))}
            </div>

            {/* Numpad — implied-decimal, cash-register style: each digit
                appends on the right (£12.30 -> press 5 -> £123.05). */}
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                <button
                  key={d}
                  onClick={() => handleCashDigit(d)}
                  className="pos-btn no-select h-12 bg-surface-hover hover:bg-elevated border border-elevated rounded-lg text-foreground font-bold text-lg"
                >
                  {d}
                </button>
              ))}
              <button
                onClick={handleCashClear}
                className="pos-btn no-select h-12 bg-surface-hover hover:bg-elevated border border-elevated rounded-lg text-red-600 font-bold text-lg"
              >
                C
              </button>
              <button
                onClick={() => handleCashDigit(0)}
                className="pos-btn no-select h-12 bg-surface-hover hover:bg-elevated border border-elevated rounded-lg text-foreground font-bold text-lg"
              >
                0
              </button>
              <button
                onClick={handleCashDoubleZero}
                className="pos-btn no-select h-12 bg-surface-hover hover:bg-elevated border border-elevated rounded-lg text-foreground font-bold text-lg"
              >
                00
              </button>
            </div>

            {error && (
              <div className="text-red-600 text-sm text-center">{error}</div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setStep("method"); setCashCents(0); }}
                className="pos-btn no-select h-12 bg-elevated hover:bg-elevated-hover border border-elevated rounded-xl text-foreground font-semibold"
              >
                Back
              </button>
              <button
                onClick={() => handleProcessPayment()}
                disabled={cashAmount <= 0 || loading}
                className="pos-btn no-select h-12 bg-green-600 hover:bg-green-500 disabled:bg-elevated disabled:text-muted-foreground text-white font-bold rounded-xl transition-all"
              >
                {loading ? "Processing..." : cashAmount > 0 && cashAmount < amountDue + tipAmount ? `Confirm £${cashAmount.toFixed(2)} — Rest by Card/Cash` : "Confirm Payment"}
              </button>
            </div>
          </div>
        )}

        {/* Card Confirm */}
        {step === "card_confirm" && (
          <div className="space-y-4">
            <div className="bg-blue-100 border border-blue-300 rounded-xl p-6 text-center">
              <div className="text-5xl mb-3">{terminalStatus === "processing" ? "📡" : "💳"}</div>
              <div className="text-foreground text-sm mb-1">
                {terminalStatus === "processing" ? "Waiting for card on reader…" : "Present card terminal for"}
              </div>
              <div className="text-foreground text-4xl font-bold">
                {formatCurrency(amountDue + tipAmount)}
              </div>
              {tipAmount > 0 && <div className="text-muted-foreground text-xs mt-1">(includes {formatCurrency(tipAmount)} tip)</div>}
            </div>

            <div className="bg-surface-hover rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between text-foreground">
                <span>{splitCount > 1 ? `This payment (1 of ${splitCount})` : "Amount Due"}</span><span>{formatCurrency(amountDue)}</span>
              </div>
              <div className="flex justify-between text-foreground font-bold border-t border-elevated pt-2">
                <span>Total (incl. tip)</span><span className="text-red-600">{formatCurrency(amountDue + tipAmount)}</span>
              </div>
            </div>

            {(error || terminalError) && (
              <div className="text-red-600 text-sm text-center">{error || terminalError}</div>
            )}

            {readerEnabled && !useManualCard ? (
              <>
                {terminalStatus === "idle" && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setStep("method")}
                      className="pos-btn no-select h-12 bg-elevated hover:bg-elevated-hover border border-elevated rounded-xl text-foreground font-semibold"
                    >
                      Back
                    </button>
                    <button
                      onClick={startTerminalCharge}
                      className="pos-btn no-select h-12 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all"
                    >
                      📡 Charge Card Reader
                    </button>
                  </div>
                )}
                {terminalStatus === "processing" && (
                  <button
                    onClick={cancelTerminalCharge}
                    className="pos-btn no-select w-full h-12 bg-elevated hover:bg-red-100 hover:text-red-700 border border-elevated rounded-xl text-foreground font-semibold"
                  >
                    Cancel
                  </button>
                )}
                {terminalStatus === "failed" && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setTerminalStatus("idle")}
                      className="pos-btn no-select h-12 bg-elevated hover:bg-elevated-hover border border-elevated rounded-xl text-foreground font-semibold"
                    >
                      Retry
                    </button>
                    <button
                      onClick={() => { setUseManualCard(true); setTerminalStatus("idle"); setTerminalError(""); }}
                      className="pos-btn no-select h-12 bg-elevated hover:bg-elevated-hover border border-elevated rounded-xl text-foreground font-semibold text-sm"
                    >
                      Enter Manually
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setStep("method")}
                  className="pos-btn no-select h-12 bg-elevated hover:bg-elevated-hover border border-elevated rounded-xl text-foreground font-semibold"
                >
                  Back
                </button>
                <button
                  onClick={() => handleProcessPayment()}
                  disabled={loading}
                  className="pos-btn no-select h-12 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all"
                >
                  {loading ? "Processing..." : "Card Paid ✓"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Pay Later confirm */}
        {step === "pay_later_confirm" && (
          <div className="space-y-4">
            <div className="bg-amber-100 border border-amber-300 rounded-xl p-6 text-center">
              <div className="text-5xl mb-2">📌</div>
              <div className="text-amber-700 text-lg font-bold">Mark this order Pay Later?</div>
              <div className="text-foreground text-2xl font-bold mt-1">{formatCurrency(remainingBalance)}</div>
              <p className="text-muted-foreground text-xs mt-2">
                No payment is taken now. The order stays on record as owed, and will show up in
                Order History → Pending Bills until it's paid.
              </p>
            </div>
            <input
              type="text"
              placeholder="Reason (optional) — e.g. card declined, will return Friday"
              value={payLaterNote}
              onChange={(e) => setPayLaterNote(e.target.value)}
              className="w-full bg-elevated border border-elevated rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-amber-500"
            />
            {error && <div className="text-red-600 text-sm text-center">{error}</div>}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setStep("method")}
                className="pos-btn no-select h-12 bg-elevated hover:bg-elevated-hover border border-elevated rounded-xl text-foreground font-semibold"
              >
                Back
              </button>
              <button
                onClick={handlePayLater}
                disabled={loading}
                className="pos-btn no-select h-12 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all"
              >
                {loading ? "Saving…" : "Confirm Pay Later"}
              </button>
            </div>
          </div>
        )}

        {/* Pay Later confirmed */}
        {step === "pay_later_done" && (
          <div className="space-y-4">
            <div className="bg-amber-100 border border-amber-300 rounded-xl p-6 text-center">
              <div className="text-5xl mb-2">📌</div>
              <div className="text-amber-700 text-xl font-bold">Marked Pay Later</div>
              <div className="text-foreground text-sm mt-2">Find it later in Order History → Pending Bills to take payment.</div>
            </div>
            <button
              onClick={handleClose}
              className="pos-btn no-select w-full h-12 bg-red-500 hover:bg-red-400 text-white font-bold rounded-xl"
            >
              New Order
            </button>
          </div>
        )}

        {/* Partial payment recorded — bill not fully settled yet */}
        {step === "partial" && (
          <div className="space-y-4">
            <div className="bg-amber-100 border border-amber-300 rounded-xl p-6 text-center">
              <div className="text-5xl mb-2">🧾</div>
              <div className="text-amber-600 text-xl font-bold">{formatCurrency(lastPaymentAmount)} Received</div>
              <div className="text-foreground text-sm mt-2">Remaining balance</div>
              <div className="text-foreground text-3xl font-bold">{formatCurrency(remainingBalance)}</div>
            </div>
            <button
              onClick={() => { setStep("method"); setSplitCount(Math.max(1, splitCount - 1)); }}
              className="pos-btn no-select w-full h-12 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl"
            >
              Take Next Payment
            </button>
            <button
              onClick={handleClose}
              className="pos-btn no-select w-full h-11 bg-elevated hover:bg-elevated-hover border border-elevated text-foreground font-semibold rounded-xl"
            >
              Close (collect rest later)
            </button>
          </div>
        )}

        {/* Receipt */}
        {step === "receipt" && (
          <div className="space-y-4">
            <div className="bg-green-100 border border-green-300 rounded-xl p-6 text-center">
              <div className="text-5xl mb-2">✅</div>
              <div className="text-green-600 text-xl font-bold">Payment Successful!</div>
            </div>

            <div className="bg-surface-hover rounded-xl p-4 font-mono text-sm">
              <div className="text-center text-foreground font-bold mb-2">
                {brand?.name.toUpperCase()}
              </div>
              <div className="text-center text-muted-foreground text-xs mb-3">
                {brand?.address}
              </div>
              <div className="border-t border-dashed border-elevated pt-2 space-y-1">
                {items.filter(i => !i.voided).map((item, i) => (
                  <div key={i} className="flex justify-between text-foreground text-xs">
                    <span>{item.quantity}x {item.item_name}</span>
                    <span>{formatCurrency(item.item_price * item.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-elevated mt-2 pt-2 space-y-1">
                <div className="flex justify-between text-muted-foreground text-xs">
                  <span>Subtotal</span><span>{formatCurrency(subtotal)}</span>
                </div>
                {localServiceCharge > 0 && (
                  <div className="flex justify-between text-purple-700 text-xs">
                    <span>Service Charge</span><span>{formatCurrency(localServiceCharge)}</span>
                  </div>
                )}
                {tipAmount > 0 && (
                  <div className="flex justify-between text-red-700 text-xs">
                    <span>Tip</span><span>{formatCurrency(tipAmount)}</span>
                  </div>
                )}
                {localDiscount > 0 && (
                  <div className="flex justify-between text-yellow-600 text-xs">
                    <span>Discount</span><span>−{formatCurrency(localDiscount)}</span>
                  </div>
                )}
                {localLoyalty > 0 && (
                  <div className="flex justify-between text-rose-700 text-xs">
                    <span>Loyalty</span><span>−{formatCurrency(localLoyalty)}</span>
                  </div>
                )}
                <div className="flex justify-between text-foreground font-bold">
                  <span>TOTAL</span><span>{formatCurrency(localTotal + tipAmount)}</span>
                </div>
                <div className="text-right text-muted-foreground text-[10px]">incl. VAT {formatCurrency(localTax)} (on food only)</div>
                <div className="flex justify-between text-foreground text-xs">
                  <span>Paid by</span>
                  <span className="capitalize">{localTotal <= 0.009 ? "Nothing to pay" : method}</span>
                </div>
                {method === "cash" && (
                  <>
                    <div className="flex justify-between text-foreground text-xs">
                      <span>Cash given</span><span>{formatCurrency(lastCashGiven)}</span>
                    </div>
                    <div className="flex justify-between text-green-600 text-xs font-semibold">
                      <span>Change</span><span>{formatCurrency(lastChange)}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="text-center text-muted-foreground text-xs mt-3">
                {brand?.receiptFooter && <span className="whitespace-pre-line">{brand.receiptFooter}<br /></span>}
                {new Date().toLocaleString("en-GB")}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <PrintButton
                orderId={orderId}
                kind="receipt"
                label="🖨️ Print Receipt"
                className="pos-btn no-select h-12 bg-elevated hover:bg-elevated-hover border border-elevated text-foreground font-semibold rounded-xl flex items-center justify-center gap-2"
              />
              <button
                onClick={handleClose}
                className="pos-btn no-select h-12 bg-red-500 hover:bg-red-400 text-white font-bold rounded-xl"
              >
                New Order
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
