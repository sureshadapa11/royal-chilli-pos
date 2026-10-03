// Each business's apps live on subdomains of its own domain:
//   www.<domain>         customer website (this app)
//   pos.<domain>         the till (this app, /pos)
//   staff.<domain>       Staff Hub back office (this app, /staff)
//   attendance.<domain>  royal-chilli-attendance
// Kept identical in both apps (lib/app-hosts.ts) and free of server imports,
// so middleware can use it.

export type AppName = "pos" | "staff" | "attendance";

const APP_PREFIXES = ["www.", "pos.", "staff.", "attendance."];

/** Lower-case host without the port. */
export function cleanHost(host: string): string {
  return host.trim().toLowerCase().split(":")[0];
}

/** The app subdomain a host is on (www/pos/staff/attendance), or null. */
export function appPrefix(host: string | null | undefined): string | null {
  if (!host) return null;
  const h = cleanHost(host);
  return APP_PREFIXES.find((p) => h.startsWith(p))?.slice(0, -1) ?? null;
}

/** The business domain behind a host: "pos.melthouse.co.uk" -> "melthouse.co.uk". */
export function baseDomain(host: string): string {
  const h = cleanHost(host);
  const p = APP_PREFIXES.find((x) => h.startsWith(x));
  return p ? h.slice(p.length) : h;
}

const isRealDomain = (d: string) => d.includes(".") && !d.endsWith(".vercel.app") && d !== "localhost";

/**
 * Cookie domain for the staff session, so one sign-in covers a business's
 * pos., staff. and attendance. subdomains (both apps share the cookie name and
 * signing secret). Only on those app subdomains of a real domain — never on
 * *.vercel.app or localhost, and never across two businesses' domains.
 */
export function sessionCookieDomain(host: string | null | undefined): string | undefined {
  if (process.env.COOKIE_DOMAIN) return process.env.COOKIE_DOMAIN;
  if (!appPrefix(host)) return undefined;
  const base = baseDomain(host!);
  return isRealDomain(base) ? base : undefined;
}

/**
 * https://<app>.<domain> for a business, once its subdomains are live — or
 * null. A business's `domain` saved without "www." (e.g. "melthouse.co.uk")
 * is the switch that says the pos./staff./attendance. DNS is set up; while it
 * still reads "www.theroyalchilli.com" the apps keep linking to the old
 * addresses.
 */
export function appUrl(businessDomain: string | null | undefined, app: AppName): string | null {
  if (!businessDomain) return null;
  const d = cleanHost(businessDomain);
  if (APP_PREFIXES.some((p) => d.startsWith(p)) || !isRealDomain(d)) return null;
  return `https://${app}.${d}`;
}
