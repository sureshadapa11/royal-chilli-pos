import { appUrl, PORTAL_HOSTS } from "@/lib/app-hosts";

/**
 * Where a business's staff link lives: its own staff.<domain> once that's
 * live, otherwise the shared staff sign-in (which names no business). Never
 * the address the manager happens to be on, so a Reva link doesn't read
 * staff.theroyalchilli.com. Local development keeps its own origin.
 */
export function staffLinkUrl(token: string, businessDomain: string | null | undefined, origin: string): string {
  if (/^https?:\/\/(localhost|127\.)/.test(origin)) return `${origin}/l/${token}`;
  const base = appUrl(businessDomain, "staff") ?? `https://${PORTAL_HOSTS[0]}`;
  return `${base}/l/${token}`;
}
