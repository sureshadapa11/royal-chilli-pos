import { SITE_URL } from "@/lib/site-url";
import { getBusiness } from "@/lib/business";
import { DEFAULT_BUSINESS_ID } from "@/lib/business-id";
import { addressOneLine, type Address } from "@/lib/business-setup";
// Transactional email via Brevo (https://developers.brevo.com/reference/sendtransacemail).
// Same pattern as lib/stripe.ts: allowed to be unconfigured until BREVO_API_KEY
// is set, so the rest of the ordering/reservation flow never depends on email
// actually being set up. Every send is fire-and-forget from the caller — a
// failed email must never fail the order/reservation itself.
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM = { name: "The Royal Chilli", email: "Info@theroyalchilli.com" };

const RESTAURANT = {
  address: "43 Kingsley Road, Hounslow, London, TW3 1PA",
  phone: "020 8797 3044",
  mapUrl: "https://www.google.com/maps?cid=3983787686224519813",
  logoUrl: `${SITE_URL}/logo.png`,
};

export type EmailBrand = {
  name: string;
  email: string;
  address: string;
  phone: string;
  logoUrl: string;
  brandColour: string;
  mapUrl?: string;
};

export async function getEmailBrand(businessId?: number | null): Promise<EmailBrand> {
  const fallback: EmailBrand = {
    name: "The Royal Chilli",
    email: FROM.email,
    address: RESTAURANT.address,
    phone: RESTAURANT.phone,
    logoUrl: RESTAURANT.logoUrl,
    brandColour: "#E34234",
    mapUrl: RESTAURANT.mapUrl,
  };
  if (!businessId || businessId === DEFAULT_BUSINESS_ID) {
    return fallback;
  }
  const b = await getBusiness(businessId).catch(() => null);
  if (!b) return fallback;

  const addr = addressOneLine(b.trading_address as Address) || b.address || RESTAURANT.address;
  return {
    name: b.name || fallback.name,
    email: b.email || b.accounts_email || fallback.email,
    address: addr,
    phone: b.phone || fallback.phone,
    logoUrl: b.logo_url || fallback.logoUrl,
    brandColour: b.brand_colour || fallback.brandColour,
    mapUrl: fallback.mapUrl,
  };
}

// Colors/fonts match the live site's own theme (app/globals.css, layout.tsx)
// — Georgia/Arial fallbacks stand in for Playfair Display/Poppins, since
// custom web fonts don't reliably load in email clients (Outlook especially).
const C = {
  chilli: "#E34234",
  chilliDark: "#C33224",
  gold: "#B8862B",
  cream: "#FFFBEB",
  page: "#EDE6D3",
  ink: "#201B18",
  muted: "#7C716A",
  card: "#FFFFFF",
  rose: "#F8DED5",
  roseText: "#6b4a41",
  paid: "#1F7A4D",
  paidBg: "#E7F5EC",
  due: "#9A6B12",
  dueBg: "#FDF1DC",
  rule: "#EFE4C9",
};
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Arial, Helvetica, sans-serif";
const money = (n: number) => `£${n.toFixed(2)}`;

// Names and codes come from customers — escape before they go into HTML.
const esc = (v: string) => (v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// `unsubscribeUrl` marks a marketing email: adds the List-Unsubscribe header
// (Gmail/Outlook show their own "Unsubscribe" button) alongside the footer link.
async function sendBrevoEmail(to: string, subject: string, html: string, unsubscribeUrl?: string, brand?: EmailBrand) {
  if (!BREVO_API_KEY) return;
  const sender = {
    name: brand?.name ?? FROM.name,
    email: brand?.email ?? FROM.email,
  };
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender,
        to: [{ email: to }],
        subject,
        htmlContent: html,
        ...(unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` } } : {}),
      }),
    });
    if (!res.ok) {
      console.error("Brevo send failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Brevo send error:", err);
  }
}

// Shared card/section chrome so both templates below stay visually identical
// without repeating the table boilerplate.
function shell(bodyHtml: string, brand?: EmailBrand) {
  const bName = brand?.name ?? "The Royal Chilli";
  const bLogo = brand?.logoUrl ?? RESTAURANT.logoUrl;
  const bAccent = brand?.brandColour ?? C.chilli;
  const bAddress = brand?.address ?? RESTAURANT.address;
  const bPhone = brand?.phone ?? RESTAURANT.phone;
  const bEmail = brand?.email ?? FROM.email;

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}; padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; background:${C.cream}; border:1px solid ${C.rule}; border-radius:10px; overflow:hidden;">
        <tr><td align="center" style="padding:34px 24px 22px;">
          <img src="${bLogo}" width="52" height="52" alt="${esc(bName)}" style="display:block; margin:0 auto 10px; border:0;" />
          <div style="font-family:${SERIF}; font-size:13px; letter-spacing:3px; text-transform:uppercase; color:${C.ink};">${esc(bName)}</div>
        </td></tr>
        <tr><td style="height:3px; background:${bAccent}; line-height:3px; font-size:0;">&nbsp;</td></tr>
        ${bodyHtml}
        <tr><td style="padding:34px 32px 26px; background:${C.rose}; text-align:center;">
          <div style="font-family:${SERIF}; font-style:italic; font-size:16px; color:${C.ink}; margin:0 0 4px;">Thank you for choosing us.</div>
          <div style="font-family:${SANS}; font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:${C.chilliDark}; font-weight:700; margin-bottom:16px;">${esc(bName)} Team</div>
          <div style="font-family:${SANS}; font-size:12.5px; color:${C.roseText}; line-height:2;">
            ${esc(bAddress)}<br />
            <a href="tel:${bPhone.replace(/\s/g, "")}" style="color:${C.roseText}; text-decoration:none;">${esc(bPhone)}</a>
            &nbsp;&middot;&nbsp;
            <a href="mailto:${esc(bEmail)}" style="color:${C.roseText}; text-decoration:none;">${esc(bEmail)}</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>`;
}

function cardLabel(text: string) {
  return `<div style="font-family:${SANS}; font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:${C.gold}; font-weight:700;">${text}</div>`;
}

export async function sendOrderConfirmationEmail(
  to: string | null | undefined,
  data: {
    orderNumber: string;
    customerName: string;
    orderType: "takeaway" | "delivery";
    scheduledFor: string | null;
    subtotal: number;
    deliveryFee: number;
    discount: number;
    total: number;
    customerAddress: string | null; // full "address, postcode" — only for delivery
    paymentMethod: string; // e.g. "Card, paid online" | "Cash or card on collection"
    paymentStatus: "paid" | "due";
    items: { name: string; quantity: number; unitPrice: number; notes?: string | null }[];
    businessId?: number;
  }
) {
  if (!to) return;

  const brand = await getEmailBrand(data.businessId);
  const isDelivery = data.orderType === "delivery";
  const eta = data.scheduledFor
    ? new Date(data.scheduledFor).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : isDelivery
    ? "45–60 minutes"
    : "20–30 minutes";

  const itemsRows = data.items
    .map(
      (i) => `
      <tr>
        <td width="32" style="padding:10px 0; font-family:${SANS}; font-size:14px; color:${C.muted}; vertical-align:top;">${i.quantity}×</td>
        <td style="padding:10px 8px; font-family:${SANS}; font-size:14px; color:${C.ink}; font-weight:500; vertical-align:top;">
          ${i.name}${i.notes ? `<div style="font-size:12px; color:${C.muted}; margin-top:2px; font-weight:400;">${i.notes}</div>` : ""}
        </td>
        <td align="right" style="padding:10px 0; font-family:${SANS}; font-size:14px; color:${C.ink}; white-space:nowrap; vertical-align:top;">${money(i.unitPrice * i.quantity)}</td>
      </tr>`
    )
    .join("");

  const paidPill =
    data.paymentStatus === "paid"
      ? `<span style="display:inline-block; background:${C.paidBg}; color:${C.paid}; font-size:11px; font-weight:700; padding:3px 9px; border-radius:999px; margin-left:4px;">Paid</span>`
      : `<span style="display:inline-block; background:${C.dueBg}; color:${C.due}; font-size:11px; font-weight:700; padding:3px 9px; border-radius:999px; margin-left:4px;">Due ${data.orderType === "delivery" ? "on delivery" : "on collection"}</span>`;

  const locationBlock = isDelivery
    ? `
      <td width="50%" style="padding:0 8px 0 0; vertical-align:top;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px solid ${C.rule}; border-radius:12px;">
          <tr><td style="padding:18px 22px 12px;">${cardLabel("Delivering To")}</td></tr>
          <tr><td style="padding:0 22px 20px; font-family:${SANS}; font-size:13.5px; color:${C.ink}; line-height:1.6;">${data.customerAddress || ""}</td></tr>
        </table>
      </td>`
    : `
      <td width="50%" style="padding:0 8px 0 0; vertical-align:top;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px solid ${C.rule}; border-radius:12px;">
          <tr><td style="padding:18px 22px 12px;">${cardLabel("Collect From")}</td></tr>
          <tr><td style="padding:0 22px 20px; font-family:${SANS}; font-size:13.5px; color:${C.ink}; line-height:1.6;">
            ${esc(brand.address)}<br />
            ${brand.mapUrl ? `<a href="${brand.mapUrl}" style="color:${brand.brandColour}; text-decoration:none; font-size:12.5px;">Get directions →</a>` : ""}
          </td></tr>
        </table>
      </td>`;

  const body = `
    <tr><td align="center" style="padding:32px 32px 8px;">
      <div style="font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.gold}; font-weight:700; margin-bottom:14px;">Order Confirmed 🎉</div>
      <div style="font-family:${SERIF}; font-weight:700; font-size:27px; line-height:1.3; color:${C.ink}; margin:0 0 10px;">Thanks for your order, <em style="color:${brand.brandColour}; font-style:italic;">${data.customerName}</em>.</div>
      <div style="font-family:${SANS}; color:${C.muted}; font-size:14px; max-width:420px; margin:0 auto; line-height:1.55;">We've got it, and it's already on its way to the kitchen. Here's everything you need to know.</div>
    </td></tr>
    <tr><td align="center" style="padding:18px 24px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px solid ${C.rule}; border-radius:999px;">
        <tr><td style="padding:8px 18px; font-family:${SERIF}; font-weight:700; font-size:14px; color:${C.ink};">Order <span style="color:${brand.brandColour};">#${data.orderNumber}</span></td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:26px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px solid ${C.rule}; border-radius:12px;">
        <tr><td style="padding:18px 22px 4px;">${cardLabel("Order Details")}</td></tr>
        <tr><td style="padding:12px 22px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="50%" style="padding:6px 8px 6px 0; font-family:${SANS}; vertical-align:top;">
                <div style="font-size:11px; color:${C.muted};">Order Type</div>
                <div style="font-size:14px; font-weight:700; color:${C.ink};">${isDelivery ? "Delivery" : "Collection"}</div>
              </td>
              <td width="50%" style="padding:6px 0 6px 8px; font-family:${SANS}; vertical-align:top;">
                <div style="font-size:11px; color:${C.muted};">${data.scheduledFor ? "Scheduled for" : isDelivery ? "Estimated delivery" : "Ready in"}</div>
                <div style="font-size:14px; font-weight:700; color:${C.ink};">${eta}</div>
              </td>
            </tr>
            <tr>
              <td colspan="2" style="padding:10px 0 0; font-family:${SANS}; vertical-align:top;">
                <div style="font-size:11px; color:${C.muted};">Payment</div>
                <div style="font-size:14px; font-weight:700; color:${C.ink};">${data.paymentMethod}${paidPill}</div>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:16px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px solid ${C.rule}; border-radius:12px;">
        <tr><td style="padding:18px 22px 4px;">${cardLabel("Your Order")}</td></tr>
        <tr><td style="padding:10px 22px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsRows}</table>
        </td></tr>
        <tr><td style="padding:14px 22px 20px; border-top:1px solid ${C.rule};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${SANS};">
            <tr><td style="padding:5px 0; font-size:13.5px; color:${C.muted};">Subtotal</td><td align="right" style="padding:5px 0; font-size:13.5px; color:${C.muted};">${money(data.subtotal)}</td></tr>
            ${data.deliveryFee > 0 ? `<tr><td style="padding:5px 0; font-size:13.5px; color:${C.muted};">Delivery fee</td><td align="right" style="padding:5px 0; font-size:13.5px; color:${C.muted};">${money(data.deliveryFee)}</td></tr>` : ""}
            ${data.discount > 0 ? `<tr><td style="padding:5px 0; font-size:13.5px; color:${C.muted};">Discount</td><td align="right" style="padding:5px 0; font-size:13.5px; color:${C.muted};">–${money(data.discount)}</td></tr>` : ""}
            <tr><td style="padding:12px 0 0; border-top:1px solid ${C.rule}; font-size:17px; font-weight:700; color:${C.ink};">Total</td><td align="right" style="padding:12px 0 0; border-top:1px solid ${C.rule}; font-size:17px; font-weight:700; color:${brand.brandColour};">${money(data.total)}</td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:16px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${locationBlock}
        <td width="50%" style="padding:0 0 0 8px; vertical-align:top;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px solid ${C.rule}; border-radius:12px;">
            <tr><td style="padding:18px 22px 12px;">${cardLabel("Need Help?")}</td></tr>
            <tr><td style="padding:0 22px 20px; font-family:${SANS}; font-size:13px; color:${C.muted}; line-height:1.6;">
              Call us and quote your order number.<br />
              <a href="tel:${brand.phone.replace(/\s/g, "")}" style="color:${C.ink}; font-weight:700; text-decoration:none;">${esc(brand.phone)}</a>
            </td></tr>
          </table>
        </td>
      </tr></table>
    </td></tr>

    <tr><td align="center" style="padding:16px 32px 4px; font-family:${SANS}; font-size:12.5px; color:${C.muted}; line-height:1.6;">
      Questions about this order? Just call us — quote <strong style="color:${C.ink};">Order #${data.orderNumber}</strong> and we'll sort it right away.
    </td></tr>`;

  await sendBrevoEmail(to, `Order confirmed — ${data.orderNumber} 🎉`, shell(body, brand), undefined, brand);
}

export async function sendReservationConfirmationEmail(
  to: string | null | undefined,
  data: {
    customerName: string;
    partySize: number;
    reservationDate: string;
    reservationTime: string;
    waitlisted: boolean;
    depositAmount: number;
    businessId?: number;
  }
) {
  if (!to) return;

  const brand = await getEmailBrand(data.businessId);

  const statusLine = data.waitlisted
    ? "You've been added to the waitlist for this time — we'll be in touch if a table frees up."
    : "Your table is confirmed — we're looking forward to having you.";

  const body = `
    <tr><td align="center" style="padding:32px 32px 8px;">
      <div style="font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.gold}; font-weight:700; margin-bottom:14px;">${data.waitlisted ? "You're On The Waitlist" : "Reservation Confirmed 🎉"}</div>
      <div style="font-family:${SERIF}; font-weight:700; font-size:27px; line-height:1.3; color:${C.ink}; margin:0 0 10px;">Hi ${data.customerName},</div>
      <div style="font-family:${SANS}; color:${C.muted}; font-size:14px; max-width:420px; margin:0 auto; line-height:1.55;">${statusLine}</div>
    </td></tr>

    <tr><td style="padding:26px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px solid ${C.rule}; border-radius:12px;">
        <tr><td style="padding:18px 22px 4px;">${cardLabel("Booking Details")}</td></tr>
        <tr><td style="padding:12px 22px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="50%" style="padding:6px 8px 6px 0; font-family:${SANS}; vertical-align:top;">
                <div style="font-size:11px; color:${C.muted};">Date</div>
                <div style="font-size:14px; font-weight:700; color:${C.ink};">${data.reservationDate}</div>
              </td>
              <td width="50%" style="padding:6px 0 6px 8px; font-family:${SANS}; vertical-align:top;">
                <div style="font-size:11px; color:${C.muted};">Time</div>
                <div style="font-size:14px; font-weight:700; color:${C.ink};">${data.reservationTime}</div>
              </td>
            </tr>
            <tr>
              <td colspan="2" style="padding:10px 0 0; font-family:${SANS};">
                <div style="font-size:11px; color:${C.muted};">Party Size</div>
                <div style="font-size:14px; font-weight:700; color:${C.ink};">${data.partySize} ${data.partySize === 1 ? "guest" : "guests"}</div>
              </td>
            </tr>
            ${
              data.depositAmount > 0
                ? `<tr><td colspan="2" style="padding:14px 0 0; border-top:1px solid ${C.rule}; margin-top:10px; font-family:${SANS};">
                    <div style="font-size:11px; color:${C.muted};">Deposit required to secure this booking</div>
                    <div style="font-size:17px; font-weight:700; color:${brand.brandColour};">${money(data.depositAmount)}</div>
                  </td></tr>`
                : ""
            }
          </table>
        </td></tr>
      </table>
    </td></tr>

    <tr><td align="center" style="padding:16px 32px 4px; font-family:${SANS}; font-size:12.5px; color:${C.muted}; line-height:1.6;">
      Need to change or cancel? Just give us a call — <a href="tel:${brand.phone.replace(/\s/g, "")}" style="color:${C.ink}; font-weight:700; text-decoration:none;">${esc(brand.phone)}</a>
    </td></tr>`;

  await sendBrevoEmail(
    to,
    data.waitlisted ? `You're on the waitlist — ${brand.name}` : `Reservation confirmed — ${brand.name}`,
    shell(body, brand),
    undefined,
    brand
  );
}

// Customer account — password reset. resetUrl already has the token in it
// (see app/api/account/reset-password); this email never handles the token
// itself, just links to the page that does.
export async function sendPasswordResetEmail(to: string, customerName: string, resetUrl: string) {
  const body = `
    <tr><td align="center" style="padding:32px 32px 8px;">
      <div style="font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.gold}; font-weight:700; margin-bottom:14px;">Reset Your Password</div>
      <div style="font-family:${SERIF}; font-weight:700; font-size:27px; line-height:1.3; color:${C.ink}; margin:0 0 10px;">Hi ${customerName},</div>
      <div style="font-family:${SANS}; color:${C.muted}; font-size:14px; max-width:420px; margin:0 auto; line-height:1.55;">
        We got a request to reset the password on your account. This link works for 1 hour.
      </div>
    </td></tr>

    <tr><td align="center" style="padding:22px 24px 6px;">
      <a href="${resetUrl}" style="display:inline-block; background:${C.chilli}; color:#fff; font-family:${SANS}; font-size:14px; font-weight:700; text-decoration:none; padding:13px 28px; border-radius:8px;">
        Choose a new password
      </a>
    </td></tr>

    <tr><td align="center" style="padding:16px 32px 4px; font-family:${SANS}; font-size:12.5px; color:${C.muted}; line-height:1.6;">
      Didn't request this? You can safely ignore this email — your password won't change.
    </td></tr>`;

  await sendBrevoEmail(to, "Reset your password — The Royal Chilli", shell(body));
}

// Sent once an order is fully paid, whichever channel it came from (POS
// dine-in, POS takeaway/delivery, or a QR self-order paid at the till) —
// this is the gap that left dine-in/QR customers with no confirmation at
// all: sendOrderConfirmationEmail only ever fires for the website's own
// checkout, and nothing was sent at payment time for any channel.
export async function sendPaymentReceiptEmail(
  to: string | null | undefined,
  data: {
    orderNumber: string;
    customerName: string;
    tableNumber: string | null; // null for takeaway/delivery
    orderType: "dine_in" | "takeaway" | "delivery";
    subtotal: number;
    discount: number;
    loyaltyDiscount?: number;
    loyaltyLabel?: string | null;
    tip?: number;
    tax: number;
    serviceCharge: number;
    total: number; // the bill, before tip
    paymentMethod: string; // e.g. "Cash", "Card", "Cash + Card"
    paidAt: string; // ISO
    items: { name: string; quantity: number; unitPrice: number; notes?: string | null }[];
    loyalty?: { pointsEarned: number; newBalance: number };
    businessId?: number;
  }
) {
  if (!to) return;

  const brand = await getEmailBrand(data.businessId);

  const itemsRows = data.items
    .map(
      (i) => `
      <tr>
        <td width="32" style="padding:10px 0; font-family:${SANS}; font-size:14px; color:${C.muted}; vertical-align:top;">${i.quantity}×</td>
        <td style="padding:10px 8px; font-family:${SANS}; font-size:14px; color:${C.ink}; font-weight:500; vertical-align:top;">
          ${i.name}${i.notes ? `<div style="font-size:12px; color:${C.muted}; margin-top:2px; font-weight:400;">${i.notes}</div>` : ""}
        </td>
        <td align="right" style="padding:10px 0; font-family:${SANS}; font-size:14px; color:${C.ink}; white-space:nowrap; vertical-align:top;">${money(i.unitPrice * i.quantity)}</td>
      </tr>`
    )
    .join("");

  const paidWhen = new Date(data.paidAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const placeLabel = data.orderType === "dine_in" ? (data.tableNumber ? `Table ${data.tableNumber}` : "Dine-in") : data.orderType === "delivery" ? "Delivery" : "Collection";

  const body = `
    <tr><td align="center" style="padding:32px 32px 8px;">
      <span style="display:inline-block; background:${C.paidBg}; color:${C.paid}; font-size:12px; font-weight:700; letter-spacing:1px; padding:5px 14px; border-radius:999px;">✓ PAID</span>
      <div style="font-family:${SERIF}; font-weight:700; font-size:27px; line-height:1.3; color:${C.ink}; margin:14px 0 10px;">Thank you, <em style="color:${brand.brandColour}; font-style:italic;">${data.customerName}</em>.</div>
      <div style="font-family:${SANS}; color:${C.muted}; font-size:14px;">Here's your receipt for this visit.</div>
    </td></tr>
    <tr><td align="center" style="padding:18px 24px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px solid ${C.rule}; border-radius:999px;">
        <tr><td style="padding:8px 18px; font-family:${SERIF}; font-weight:700; font-size:14px; color:${C.ink};">Order <span style="color:${brand.brandColour};">#${data.orderNumber}</span> · ${placeLabel}</td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:22px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px solid ${C.rule}; border-radius:12px;">
        <tr><td style="padding:18px 22px 4px;">${cardLabel("Your Order")}</td></tr>
        <tr><td style="padding:10px 22px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsRows}</table>
        </td></tr>
        <tr><td style="padding:14px 22px 20px; border-top:1px solid ${C.rule};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${SANS};">
            <tr><td style="padding:5px 0; font-size:13.5px; color:${C.muted};">Subtotal</td><td align="right" style="padding:5px 0; font-size:13.5px; color:${C.muted};">${money(data.subtotal)}</td></tr>
            ${data.serviceCharge > 0 ? `<tr><td style="padding:5px 0; font-size:13.5px; color:${C.muted};">Service charge</td><td align="right" style="padding:5px 0; font-size:13.5px; color:${C.muted};">${money(data.serviceCharge)}</td></tr>` : ""}
            ${(data.tip ?? 0) > 0 ? `<tr><td style="padding:5px 0; font-size:13.5px; color:${C.muted};">Tip</td><td align="right" style="padding:5px 0; font-size:13.5px; color:${C.muted};">${money(data.tip ?? 0)}</td></tr>` : ""}
            ${data.discount > 0 ? `<tr><td style="padding:5px 0; font-size:13.5px; color:${C.muted};">Discount</td><td align="right" style="padding:5px 0; font-size:13.5px; color:${C.muted};">–${money(data.discount)}</td></tr>` : ""}
            ${(data.loyaltyDiscount ?? 0) > 0 ? `<tr><td style="padding:5px 0; font-size:13.5px; color:${C.muted};">${data.loyaltyLabel || "Loyalty"}</td><td align="right" style="padding:5px 0; font-size:13.5px; color:${C.muted};">–${money(data.loyaltyDiscount ?? 0)}</td></tr>` : ""}
            <tr><td style="padding:12px 0 0; border-top:1px solid ${C.rule}; font-size:17px; font-weight:700; color:${C.ink};">Total</td><td align="right" style="padding:12px 0 0; border-top:1px solid ${C.rule}; font-size:17px; font-weight:700; color:${brand.brandColour};">${money(data.total + (data.tip ?? 0))}</td></tr>
            <tr><td colspan="2" style="padding:2px 0 0; font-size:11px; color:${C.muted};">incl. VAT ${money(data.tax)}</td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:16px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px solid ${C.rule}; border-radius:12px;">
        <tr><td style="padding:18px 22px 12px;">${cardLabel("Payment")}</td></tr>
        <tr><td style="padding:0 22px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="50%" style="padding:6px 8px 6px 0; font-family:${SANS}; vertical-align:top;">
                <div style="font-size:11px; color:${C.muted};">Method</div>
                <div style="font-size:14px; font-weight:700; color:${C.ink};">${data.paymentMethod}</div>
              </td>
              <td width="50%" style="padding:6px 0 6px 8px; font-family:${SANS}; vertical-align:top;">
                <div style="font-size:11px; color:${C.muted};">Paid</div>
                <div style="font-size:14px; font-weight:700; color:${C.ink};">${paidWhen}</div>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>

    ${data.loyalty ? `
    <tr><td align="center" style="padding:16px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.rose}; border-radius:12px;">
        <tr><td align="center" style="padding:16px 22px;">
          <div style="font-family:${SANS}; font-size:13.5px; color:${C.roseText};">🎁 You earned <strong>${data.loyalty.pointsEarned} points</strong> this visit</div>
          <div style="font-family:${SANS}; font-size:12px; color:${C.roseText}; margin-top:3px;">New balance: ${data.loyalty.newBalance} points</div>
        </td></tr>
      </table>
    </td></tr>` : ""}

    <tr><td align="center" style="padding:16px 32px 4px; font-family:${SANS}; font-size:12.5px; color:${C.muted}; line-height:1.6;">
      Questions about this receipt? Just call us — quote <strong style="color:${C.ink};">Order #${data.orderNumber}</strong> and we'll sort it right away.
    </td></tr>`;

  await sendBrevoEmail(to, `Receipt — ${data.orderNumber} · ${money(data.total)} paid`, shell(body, brand), undefined, brand);
}

// Sent when an unpaid order is cancelled (whole-order cancel, or voiding the
// last item down to nothing) and a customer email is on file. Paid orders
// can't reach this path — see cancelOrderAndFreeTable — so this never has to
// mention money, only the items.
export async function sendOrderCancellationEmail(
  to: string | null | undefined,
  data: {
    orderNumber: string;
    customerName: string;
    items: { name: string; quantity: number }[];
    businessId?: number;
  }
) {
  if (!to) return;

  const brand = await getEmailBrand(data.businessId);

  const itemsRows = data.items
    .map(
      (i) => `
      <tr>
        <td width="32" style="padding:8px 0; font-family:${SANS}; font-size:14px; color:${C.muted}; vertical-align:top;">${i.quantity}×</td>
        <td style="padding:8px 8px; font-family:${SANS}; font-size:14px; color:${C.ink}; font-weight:500; vertical-align:top;">${i.name}</td>
      </tr>`
    )
    .join("");

  const body = `
    <tr><td align="center" style="padding:32px 32px 8px;">
      <span style="display:inline-block; background:${C.dueBg}; color:${C.due}; font-size:12px; font-weight:700; letter-spacing:1px; padding:5px 14px; border-radius:999px;">CANCELLED</span>
      <div style="font-family:${SERIF}; font-weight:700; font-size:27px; line-height:1.3; color:${C.ink}; margin:14px 0 10px;">Hi ${data.customerName},</div>
      <div style="font-family:${SANS}; color:${C.muted}; font-size:14px; max-width:420px; margin:0 auto; line-height:1.55;">Your order has been cancelled. No payment was taken, so there's nothing to refund.</div>
    </td></tr>
    <tr><td align="center" style="padding:18px 24px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px solid ${C.rule}; border-radius:999px;">
        <tr><td style="padding:8px 18px; font-family:${SERIF}; font-weight:700; font-size:14px; color:${C.ink};">Order <span style="color:${brand.brandColour};">#${data.orderNumber}</span></td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:22px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px solid ${C.rule}; border-radius:12px;">
        <tr><td style="padding:18px 22px 4px;">${cardLabel("Cancelled Items")}</td></tr>
        <tr><td style="padding:10px 22px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsRows}</table>
        </td></tr>
      </table>
    </td></tr>

    <tr><td align="center" style="padding:16px 32px 4px; font-family:${SANS}; font-size:12.5px; color:${C.muted}; line-height:1.6;">
      If this wasn't expected, just call us — quote <strong style="color:${C.ink};">Order #${data.orderNumber}</strong> and we'll sort it right away.
    </td></tr>`;

  await sendBrevoEmail(to, `Order cancelled — ${data.orderNumber}`, shell(body, brand), undefined, brand);
}

// Win-back offer — only ever sent to a customer with marketing_consent set
// (checked by the caller, app/api/loyalty/winback/send). The offer is an
// already-issued reward code, not an automatic discount — the customer has
// to bring it back in to use it.
export async function sendWinBackEmail(
  to: string | null | undefined,
  data: { customerName: string; rewardName: string; code: string; expiresAt: string }
) {
  if (!to) return;

  const expiryLabel = new Date(data.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

  const body = `
    <tr><td style="padding:28px 32px 8px;">
      ${cardLabel("We miss you")}
      <div style="font-family:${SERIF}; font-size:22px; color:${C.ink}; margin-top:6px;">A little something for you, ${data.customerName.split(" ")[0]}</div>
      <div style="font-family:${SANS}; font-size:14px; color:${C.muted}; margin-top:6px; line-height:1.6;">
        It's been a while since your last visit — here's ${data.rewardName.toLowerCase().startsWith("free") ? "" : "a "}<strong style="color:${C.ink};">${data.rewardName}</strong> on us, next time you're in.
      </div>
    </td></tr>
    <tr><td style="padding:8px 32px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px dashed ${C.gold}; border-radius:10px;">
        <tr><td align="center" style="padding:24px;">
          ${cardLabel("Show this code at the till")}
          <div style="font-family:${SANS}; font-size:28px; font-weight:700; letter-spacing:4px; color:${C.chilli}; margin-top:8px;">${data.code}</div>
          <div style="font-family:${SANS}; font-size:12px; color:${C.muted}; margin-top:8px;">Valid until ${expiryLabel}</div>
        </td></tr>
      </table>
    </td></tr>`;

  await sendBrevoEmail(to, `A gift from The Royal Chilli — ${data.rewardName}`, shell(body));
}

// "Your order is ready" — website collection/delivery orders, sent once when
// the kitchen marks the order ready (lib/order-notifications.ts).
export async function sendOrderReadyEmail(
  to: string | null | undefined,
  data: { customerName: string; orderNumber: string; orderType: string; businessId?: number }
) {
  if (!to) return;
  const brand = await getEmailBrand(data.businessId);
  const collection = data.orderType !== "delivery";
  const body = `
    <tr><td style="padding:28px 32px 28px;">
      ${cardLabel(collection ? "Ready to collect" : "On its way soon")}
      <div style="font-family:${SERIF}; font-size:22px; color:${C.ink}; margin-top:6px;">Your order is ready, ${data.customerName.split(" ")[0]}!</div>
      <div style="font-family:${SANS}; font-size:14px; color:${C.muted}; margin-top:8px; line-height:1.6;">
        ${collection
          ? `Order <strong style="color:${C.ink};">${data.orderNumber}</strong> is ready — come and collect it from ${esc(brand.address)}.`
          : `Order <strong style="color:${C.ink};">${data.orderNumber}</strong> is ready and will be with you shortly.`}
      </div>
    </td></tr>`;
  await sendBrevoEmail(to, collection ? `Your order ${data.orderNumber} is ready to collect` : `Your order ${data.orderNumber} is on its way soon`, shell(body, brand), undefined, brand);
}

// "How was your meal?" — the day after, to customers who opted in to hear
// from us (lib/order-notifications.ts, daily cron).
export async function sendReviewRequestEmail(
  to: string | null | undefined,
  data: { customerName: string; reviewUrl: string; unsubscribeUrl?: string }
) {
  if (!to) return;
  const body = `
    <tr><td style="padding:28px 32px 8px;">
      ${cardLabel("Thank you")}
      <div style="font-family:${SERIF}; font-size:22px; color:${C.ink}; margin-top:6px;">How was your meal, ${data.customerName.split(" ")[0]}?</div>
      <div style="font-family:${SANS}; font-size:14px; color:${C.muted}; margin-top:8px; line-height:1.6;">
        We'd love to hear what you thought. A quick Google review helps a small, local restaurant more than you'd think.
      </div>
    </td></tr>
    <tr><td align="center" style="padding:12px 32px 28px;">
      <a href="${data.reviewUrl}" style="display:inline-block; background:${C.chilli}; color:#fff; text-decoration:none; font-family:${SANS}; font-size:15px; font-weight:700; padding:12px 28px; border-radius:8px;">Leave a review</a>
      ${data.unsubscribeUrl
        ? unsubscribeFooter(data.unsubscribeUrl)
        : `<div style="font-family:${SANS}; font-size:11px; color:${C.muted}; margin-top:16px;">You're receiving this because you asked to hear from us. Reply "unsubscribe" and we'll stop.</div>`}
    </td></tr>`;
  await sendBrevoEmail(to, "How was your meal at The Royal Chilli?", shell(body), data.unsubscribeUrl);
}

// ---------- Rewards Club ----------

const firstName = (name: string) => esc((name || "there").trim().split(" ")[0] || "there");
const ukDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "long" });

function button(href: string, label: string) {
  return `<a href="${esc(href)}" style="display:inline-block; background:${C.chilli}; color:#fff; text-decoration:none; font-family:${SANS}; font-size:15px; font-weight:700; padding:12px 28px; border-radius:8px;">${label}</a>`;
}

function codeBox(label: string, code: string, note: string) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card}; border:1px dashed ${C.gold}; border-radius:10px;">
      <tr><td align="center" style="padding:22px;">
        ${cardLabel(label)}
        <div style="font-family:${SANS}; font-size:28px; font-weight:700; letter-spacing:4px; color:${C.chilli}; margin-top:8px;">${esc(code)}</div>
        <div style="font-family:${SANS}; font-size:12px; color:${C.muted}; margin-top:8px; line-height:1.5;">${note}</div>
      </td></tr>
    </table>`;
}

const howItWorks = `
  <div style="font-family:${SANS}; font-size:13px; color:${C.muted}; line-height:1.9;">
    🍛 <strong style="color:${C.ink};">10 points for every £1</strong> — dine-in, collection or delivery<br />
    ⭐ <strong style="color:${C.ink};">Double points Tuesday to Thursday</strong><br />
    🎁 <strong style="color:${C.ink};">100 points = £1 off</strong> when you dine in — up to £10 a visit<br />
    🔁 Bonus points on your 2nd, 3rd and every 5th visit
  </div>`;

function unsubscribeFooter(url: string) {
  return `<div style="font-family:${SANS}; font-size:11px; color:${C.muted}; margin-top:16px;">You're receiving this because you asked to hear about offers and rewards. <a href="${esc(url)}" style="color:${C.muted};">Unsubscribe</a></div>`;
}

// Sent to everyone who joins (website sign-up or at the till, if they gave
// an email): the welcome voucher code, their points, how it works, and their
// Bring a Friend link.
export async function sendWelcomeEmail(
  to: string | null | undefined,
  data: {
    customerName: string;
    signupPoints: number;
    voucherCode: string | null;
    voucherValidFrom: string | null;
    voucherExpiresAt: string | null;
    referralLink: string | null;
    accountUrl: string;
  },
) {
  if (!to) return;
  const voucher = data.voucherCode
    ? `<tr><td style="padding:8px 32px 8px;">${codeBox(
        "Your welcome gift · 20% off dine-in",
        data.voucherCode,
        `Show this code when you pay for a dine-in meal (up to £20 off).${data.voucherValidFrom ? `<br />Use it from ${ukDate(data.voucherValidFrom)}` : ""}${data.voucherExpiresAt ? ` · valid until ${ukDate(data.voucherExpiresAt)}` : ""}`,
      )}</td></tr>`
    : "";
  const friend = data.referralLink
    ? `<tr><td style="padding:16px 32px 8px;">
        ${cardLabel("Bring a friend")}
        <div style="font-family:${SANS}; font-size:14px; color:${C.muted}; margin-top:6px; line-height:1.6;">
          Share your link — your friend gets 200 points and 20% off, and you get <strong style="color:${C.ink};">£5 off</strong> when they visit.<br />
          <a href="${esc(data.referralLink)}" style="color:${C.chilli};">${esc(data.referralLink)}</a>
        </div>
      </td></tr>`
    : "";
  const body = `
    <tr><td style="padding:28px 32px 8px;">
      ${cardLabel("Welcome to the Rewards Club")}
      <div style="font-family:${SERIF}; font-size:22px; color:${C.ink}; margin-top:6px;">You're in, ${firstName(data.customerName)}!</div>
      <div style="font-family:${SANS}; font-size:14px; color:${C.muted}; margin-top:8px; line-height:1.6;">
        We've added <strong style="color:${C.ink};">${data.signupPoints} points</strong> to your account to get you started.
      </div>
    </td></tr>
    ${voucher}
    <tr><td style="padding:16px 32px 8px;">${cardLabel("How it works")}<div style="margin-top:6px;">${howItWorks}</div></td></tr>
    ${friend}
    <tr><td align="center" style="padding:16px 32px 28px;">${button(data.accountUrl, "See my rewards")}</td></tr>`;
  await sendBrevoEmail(to, "Welcome to The Royal Chilli Rewards Club 🎁", shell(body));
}

// The morning after someone's first visit (opted-in only): points earned,
// balance, their welcome voucher if still unused, and the review link.
export async function sendThankYouEmail(
  to: string | null | undefined,
  data: {
    customerName: string;
    pointsEarned: number;
    balance: number;
    voucherCode: string | null;
    voucherExpiresAt: string | null;
    reviewUrl: string | null;
    accountUrl: string;
    unsubscribeUrl: string;
  },
) {
  if (!to) return;
  const voucher = data.voucherCode
    ? `<tr><td style="padding:8px 32px 8px;">${codeBox(
        "Don't forget · 20% off your next dine-in visit",
        data.voucherCode,
        data.voucherExpiresAt ? `Valid until ${ukDate(data.voucherExpiresAt)}` : "",
      )}</td></tr>`
    : "";
  const body = `
    <tr><td style="padding:28px 32px 8px;">
      ${cardLabel("Thank you")}
      <div style="font-family:${SERIF}; font-size:22px; color:${C.ink}; margin-top:6px;">Thanks for visiting, ${firstName(data.customerName)}!</div>
      <div style="font-family:${SANS}; font-size:14px; color:${C.muted}; margin-top:8px; line-height:1.6;">
        ${data.pointsEarned > 0 ? `You earned <strong style="color:${C.ink};">${data.pointsEarned} points</strong>. ` : ""}You now have
        <strong style="color:${C.ink};">${data.balance} points</strong> — worth £${(data.balance / 100).toFixed(2)} off a dine-in meal.
        Come back for your <strong style="color:${C.ink};">2nd-visit bonus</strong>, and remember points are doubled Tuesday to Thursday.
      </div>
    </td></tr>
    ${voucher}
    <tr><td align="center" style="padding:16px 32px 28px;">
      ${data.reviewUrl ? `<div style="font-family:${SANS}; font-size:14px; color:${C.muted}; margin-bottom:12px;">Enjoyed it? A quick Google review helps a small, local restaurant more than you'd think.</div>${button(data.reviewUrl, "Leave a review")}<br /><br />` : ""}
      <a href="${esc(data.accountUrl)}" style="font-family:${SANS}; font-size:13px; color:${C.chilli};">See my rewards</a>
      ${unsubscribeFooter(data.unsubscribeUrl)}
    </td></tr>`;
  await sendBrevoEmail(to, "Thanks for visiting The Royal Chilli", shell(body), data.unsubscribeUrl);
}

// 10 days after the first visit, if they haven't been back (opted-in only).
export async function sendNudgeEmail(
  to: string | null | undefined,
  data: {
    customerName: string;
    balance: number;
    secondVisitBonus: number;
    voucherCode: string | null;
    voucherExpiresAt: string | null;
    accountUrl: string;
    unsubscribeUrl: string;
  },
) {
  if (!to) return;
  const voucher = data.voucherCode
    ? `<tr><td style="padding:8px 32px 8px;">${codeBox(
        "Still waiting for you · 20% off dine-in",
        data.voucherCode,
        data.voucherExpiresAt ? `Use it before ${ukDate(data.voucherExpiresAt)}` : "",
      )}</td></tr>`
    : "";
  const body = `
    <tr><td style="padding:28px 32px 8px;">
      ${cardLabel("We'd love to see you again")}
      <div style="font-family:${SERIF}; font-size:22px; color:${C.ink}; margin-top:6px;">Come back soon, ${firstName(data.customerName)}</div>
      <div style="font-family:${SANS}; font-size:14px; color:${C.muted}; margin-top:8px; line-height:1.6;">
        You've got <strong style="color:${C.ink};">${data.balance} points</strong> waiting${data.secondVisitBonus > 0 ? `, and your next visit earns a
        <strong style="color:${C.ink};">${data.secondVisitBonus}-point 2nd-visit bonus</strong>` : ""}. Pop in Tuesday to Thursday for double points.
      </div>
    </td></tr>
    ${voucher}
    <tr><td align="center" style="padding:16px 32px 28px;">
      ${button("https://www.google.com/maps?cid=3983787686224519813", "Find us")}
      <div style="margin-top:12px;"><a href="${esc(data.accountUrl)}" style="font-family:${SANS}; font-size:13px; color:${C.chilli};">See my rewards</a></div>
      ${unsubscribeFooter(data.unsubscribeUrl)}
    </td></tr>`;
  await sendBrevoEmail(to, "We'd love to see you again at The Royal Chilli", shell(body), data.unsubscribeUrl);
}

// To the member who shared their link, when their friend's first visit
// unlocks the £5 voucher (about their own account, so sent regardless of
// marketing consent).
export async function sendReferralUnlockedEmail(
  to: string | null | undefined,
  data: { customerName: string; friendName: string; code: string; expiresAt: string; accountUrl: string },
) {
  if (!to) return;
  const body = `
    <tr><td style="padding:28px 32px 8px;">
      ${cardLabel("Bring a Friend")}
      <div style="font-family:${SERIF}; font-size:22px; color:${C.ink}; margin-top:6px;">Your £5 is unlocked, ${firstName(data.customerName)}!</div>
      <div style="font-family:${SANS}; font-size:14px; color:${C.muted}; margin-top:8px; line-height:1.6;">
        ${firstName(data.friendName)} came in for their first visit — thanks for bringing them. Here's £5 off your next dine-in meal.
      </div>
    </td></tr>
    <tr><td style="padding:8px 32px 8px;">${codeBox("Show this code at the till", data.code, `Dine-in · valid until ${ukDate(data.expiresAt)}`)}</td></tr>
    <tr><td align="center" style="padding:16px 32px 28px;">${button(data.accountUrl, "See my rewards")}</td></tr>`;
  await sendBrevoEmail(to, "Your £5 Bring a Friend reward is ready", shell(body));
}
