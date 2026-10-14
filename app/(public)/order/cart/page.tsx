"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import LineNote from "@/components/site/LineNote";
import { withNote, readCart, writeCart, readOrderType, writeOrderType, cartTotal, lineUnitPrice, type CartLine, type OrderType } from "@/lib/cart";
import { siteContent } from "@/lib/site-content";

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("takeaway");

  useEffect(() => {
    setCart(readCart());
    setOrderType(readOrderType());
  }, []);

  // Collection and delivery are priced differently, so switching re-prices
  // the basket — say so when the total actually changes.
  const [priceNote, setPriceNote] = useState("");
  function selectOrderType(type: OrderType) {
    if (type !== orderType && cartTotal(cart, type) !== cartTotal(cart, orderType)) {
      setPriceNote(`Prices updated for ${type === "delivery" ? "delivery" : "collection"}.`);
    }
    setOrderType(type);
    writeOrderType(type);
  }

  function bumpLine(lineId: string, delta: number) {
    setCart((prev) => {
      const next = prev
        .map((l) => (l.lineId === lineId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0);
      writeCart(next);
      return next;
    });
  }

  function removeLine(lineId: string) {
    setCart((prev) => {
      const next = prev.filter((l) => l.lineId !== lineId);
      writeCart(next);
      return next;
    });
  }

  const subtotal = cartTotal(cart, orderType);

  return (
    <div className="mx-auto max-w-lg pb-28">
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-4 backdrop-blur">
        <Link href="/order" aria-label="Back to menu" className="flex h-8 w-8 items-center justify-center rounded-full border border-border hover:border-primary">
          <ChevronLeft size={18} />
        </Link>
        <h1 className="font-[family-name:var(--font-playfair)] text-xl">Your Order</h1>
      </div>

      <div className="mt-4 flex gap-3 px-4">
        {(["takeaway", "delivery"] as const).map((t) => (
          <button
            key={t}
            onClick={() => selectOrderType(t)}
            className={`flex-1 border px-4 py-2 text-xs uppercase tracking-[0.1em] ${
              orderType === t ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {t === "takeaway" ? "Collection" : "Delivery"}
          </button>
        ))}
      </div>
      {priceNote && <p className="px-4 mt-2 text-xs font-medium text-primary">{priceNote}</p>}

      {cart.length === 0 ? (
        <div className="px-4 py-24 text-center">
          <p className="text-muted-foreground">Your basket is empty. Add a few dishes to get started.</p>
          <Link
            href="/order"
            className="mt-6 inline-block border border-primary px-8 py-3 text-xs uppercase tracking-[0.15em] text-primary transition hover:bg-primary hover:text-primary-foreground"
          >
            Browse Menu
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-4 border-y border-border px-4 py-4">
            {cart.map((l) => (
              <div key={l.lineId} className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.name}</p>
                  {l.selectedOptions.length > 0 && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{l.selectedOptions.map((o) => o.name).join(", ")}</p>
                  )}
                  <LineNote small note={l.notes} onSave={(n) => setCart((prev) => { const next = withNote(prev, l.lineId, n); writeCart(next); return next; })} />
                  <button onClick={() => removeLine(l.lineId)} className="mt-1 text-xs text-muted-foreground underline hover:text-red-500">
                    Remove
                  </button>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <button onClick={() => bumpLine(l.lineId, -1)} aria-label={`Decrease ${l.name} quantity`} className="h-7 w-7 rounded-full border border-border text-sm leading-none hover:border-primary">−</button>
                    <span className="w-4 text-center text-sm">{l.quantity}</span>
                    <button onClick={() => bumpLine(l.lineId, 1)} aria-label={`Increase ${l.name} quantity`} className="h-7 w-7 rounded-full border border-border text-sm leading-none hover:border-primary">+</button>
                  </div>
                  <span className="text-sm font-semibold text-primary">{formatCurrency(lineUnitPrice(l, orderType) * l.quantity)}</span>
                </div>
                <button onClick={() => removeLine(l.lineId)} aria-label={`Remove ${l.name}`} className="flex-shrink-0 text-muted-foreground hover:text-red-500">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="px-4 py-4">
            <Link href="/order" className="inline-block text-xs uppercase tracking-[0.15em] text-primary hover:underline">
              + Add more items
            </Link>
            <div className="mt-3 flex justify-between border-t border-border pt-3 text-sm">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {orderType === "takeaway" ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Free collection from{" "}
                <a href={siteContent.contact.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                  {siteContent.contact.address}
                </a>
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Delivery fee and minimum order depend on your postcode — checked at checkout.</p>
            )}
            <div className="mt-2 flex justify-between border-t border-border pt-3 font-semibold text-primary">
              <span>Total</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
          </div>

          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-4 backdrop-blur">
            <div className="mx-auto max-w-lg">
              <button
                onClick={() => router.push("/order/checkout")}
                className="w-full bg-primary py-3 text-xs uppercase tracking-[0.15em] text-primary-foreground hover:opacity-90"
              >
                Go to Checkout · {formatCurrency(subtotal)}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
