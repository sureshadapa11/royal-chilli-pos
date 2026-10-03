"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { HubNotice } from "@/lib/hub-notifications";
import BusinessSwitcher, { type SwitcherOption } from "@/components/staff/BusinessSwitcher";
import { initials } from "@/lib/brand-client";

export type NavItem = { href: string; label: string; icon: string; note?: string; external?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

const ROLE_LABEL: Record<string, string> = { admin: "Admin", hr: "HR", manager: "Manager", employee: "Employee", driver: "Driver" };

// Staff Hub frame: a top menu bar. On a computer each group's list opens when
// the mouse is over it (CSS, see .hub-mi in globals.css) or on click; on a
// screen narrower than 1280px (phone, tablet, laptop at 125%) the row is
// replaced by 🔔 + ☰, which open a drawer from the right.
export default function StaffShell({
  user,
  business,
  switcher,
  nav,
  notices,
  children,
}: {
  user: { name: string; role: string };
  /** The business this login is working for. */
  business: { id: number; name: string; logoUrl: string | null; tagline: string | null };
  /** The group owner's business picker (owner only). */
  switcher?: SwitcherOption[];
  nav: NavGroup[];
  notices: HubNotice[];
  children: React.ReactNode;
}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<null | "menu" | "notices">(null);
  const barRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  const active = (href: string) =>
    href === "/staff" ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  const groupActive = (g: NavGroup) => g.items.some((i) => !i.external && active(i.href.split("?")[0]));

  // Close everything on navigation, outside click and Escape.
  useEffect(() => { setOpenMenu(null); setDrawer(null); }, [pathname]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpenMenu(null); setDrawer(null); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);
  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [drawer]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const toggle = (key: string) => setOpenMenu((m) => (m === key ? null : key));
  // nav[0] is the unlabelled "Dashboard" entry; the rest are dropdown groups.
  const [dashboard, ...groups] = nav;

  const itemLink = (item: NavItem, cls: string, extra?: React.ReactNode) => {
    const body = (
      <>
        <span className="w-5 flex-shrink-0 text-center">{item.icon}</span>
        <span className="min-w-0">
          {item.label}
          {item.external && <span className="ml-1 opacity-60">↗</span>}
          {item.note && <small className="block text-[11.5px] text-muted-foreground">{item.note}</small>}
        </span>
        {extra}
      </>
    );
    return item.external ? (
      <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" className={cls}>{body}</a>
    ) : (
      <Link key={item.href} href={item.href} className={cls}>{body}</Link>
    );
  };

  const topBtn = "flex items-center gap-1.5 rounded-[9px] px-[11px] py-2 text-[13.5px] font-semibold transition-colors";
  const ddLink = "flex gap-2 rounded-lg px-2.5 py-2 text-[13.5px] text-foreground hover:bg-[#F6F1E6]";
  const badge = notices.length > 0 && (
    <span className="rounded-full bg-[#E34435] px-1.5 text-[11px] font-bold leading-[18px] text-white">{notices.length}</span>
  );

  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "var(--font-worksans)" }}>
      {/* z-35: above pages' own sticky headings (z-30, e.g. Customers & Loyalty),
          so this bar's dropdown menus are never hidden behind them; below the
          phone drawer (z-40/50). */}
      <header ref={barRef} className="sticky top-0 z-[35] border-b border-border bg-white print:hidden">
        <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-4 py-2.5">
          <Link href="/staff" className="flex min-w-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {business.logoUrl ? (
              <img src={business.logoUrl} alt="" className="h-[42px] w-[42px] flex-shrink-0 rounded-[10px] object-cover" />
            ) : (
              <span className="grid h-[42px] w-[42px] flex-shrink-0 place-items-center rounded-[10px] bg-foreground text-[15px] font-bold text-background">{initials(business.name)}</span>
            )}
            <span className="min-w-0">
              <b style={{ fontFamily: "var(--font-cinzel)" }} className="block truncate text-[15px] leading-tight text-foreground">{business.name}</b>
              <small className="hidden truncate text-[11.5px] leading-snug text-muted-foreground lg:block">
                {business.tagline && <><i style={{ fontFamily: "var(--font-playfair)" }} className="text-[#E34435]">{business.tagline}</i> · </>}{user.name} · {ROLE_LABEL[user.role] ?? user.role}
              </small>
            </span>
          </Link>

          {switcher && <BusinessSwitcher current={business.id} options={switcher} className="hidden xl:flex" />}

          {/* Wide screen: the menu row. It needs ~1,210px (logo, business
              switcher, five menus, Notifications, Logout); below xl the row
              overflowed and pushed Notifications/Logout off the right edge on
              laptops at 125% scaling, tablets and zoomed browsers — so those
              get the bell + ☰ drawer instead, which has everything. */}
          <nav className="ml-auto hidden items-center gap-0.5 xl:flex" aria-label="Staff Hub">
            {dashboard.items.map((item) => (
              <Link key={item.href} href={item.href}
                className={`${topBtn} ${active(item.href) ? "bg-[#FDECE9] text-[#C82D1D]" : "text-[#5B524B] hover:bg-[#F6F1E6] hover:text-foreground"}`}>
                {item.label}
              </Link>
            ))}
            {groups.map((g) => g.items.length === 1 && g.items[0].label === g.label ? (
              // A group of one (Settings) is just a link.
              <Link key={g.label} href={g.items[0].href}
                className={`${topBtn} ${groupActive(g) ? "bg-[#FDECE9] text-[#C82D1D]" : "text-[#5B524B] hover:bg-[#F6F1E6] hover:text-foreground"}`}>
                {g.label}
              </Link>
            ) : (
              <div key={g.label} className={`hub-mi relative ${openMenu === g.label ? "open" : ""}`}>
                <button type="button" onClick={() => toggle(g.label)} aria-expanded={openMenu === g.label}
                  className={`${topBtn} ${groupActive(g) ? "text-[#C82D1D]" : "text-[#5B524B]"} hover:bg-[#F6F1E6]`}>
                  {g.label} <span className="text-[10px] opacity-60">▼</span>
                </button>
                <div className="hub-dd absolute right-0 top-[calc(100%+6px)] min-w-[220px] rounded-xl border border-border bg-white p-1.5 shadow-[0_12px_30px_rgba(40,25,15,0.12)]">
                  {g.items.map((item) => itemLink(item, `${ddLink} ${!item.external && active(item.href.split("?")[0]) ? "bg-[#FDECE9]" : ""}`))}
                </div>
              </div>
            ))}
            <div className={`hub-mi relative ${openMenu === "__n" ? "open" : ""}`}>
              <button type="button" onClick={() => toggle("__n")} aria-expanded={openMenu === "__n"} className={`${topBtn} text-[#5B524B] hover:bg-[#F6F1E6]`}>
                Notifications {badge} <span className="text-[10px] opacity-60">▼</span>
              </button>
              <div className="hub-dd absolute right-0 top-[calc(100%+6px)] w-[300px] rounded-xl border border-border bg-white p-1.5 shadow-[0_12px_30px_rgba(40,25,15,0.12)]">
                {notices.length === 0 ? (
                  <p className="px-2.5 py-3 text-[13px] text-muted-foreground">All clear — nothing waiting.</p>
                ) : notices.map((n) => itemLink({ href: n.href, label: n.text, icon: n.icon, note: n.sub }, ddLink))}
              </div>
            </div>
            <button type="button" onClick={handleLogout} className={`${topBtn} text-muted-foreground hover:bg-[#F6F1E6]`}>Logout</button>
          </nav>

          {/* Phone, tablet and narrower laptop: bell + menu */}
          <div className="ml-auto flex items-center gap-1.5 xl:hidden">
            <button type="button" onClick={() => setDrawer("notices")} aria-label="Notifications"
              className="relative grid h-[42px] w-[42px] place-items-center rounded-xl bg-[#F6F1E6] text-[19px]">
              🔔{notices.length > 0 && <span className="absolute -right-1 -top-1">{badge}</span>}
            </button>
            <button type="button" onClick={() => setDrawer("menu")} aria-label="Open menu"
              className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-[#F6F1E6] text-[19px]">☰</button>
          </div>
        </div>
      </header>

      {/* Phone drawer */}
      <div className={`fixed inset-0 z-40 bg-[rgba(20,12,8,0.4)] transition-opacity motion-reduce:transition-none xl:hidden ${drawer ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setDrawer(null)} />
      <aside aria-hidden={!drawer}
        className={`fixed inset-y-0 right-0 z-50 flex w-[min(88vw,360px)] flex-col bg-white transition-transform duration-200 motion-reduce:transition-none xl:hidden ${drawer ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
          <span style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-[17px] font-bold">{drawer === "notices" ? "Notifications" : "Menu"}</span>
          <button type="button" onClick={() => setDrawer(null)} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-xl">✕</button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 pb-6 pt-2">
          {drawer === "notices" ? (
            notices.length === 0 ? <p className="px-2.5 py-4 text-[14px] text-muted-foreground">All clear — nothing waiting.</p>
              : notices.map((n) => itemLink({ href: n.href, label: n.text, icon: n.icon, note: n.sub }, "flex gap-2.5 rounded-[10px] px-2.5 py-3 text-[15px] hover:bg-[#FDECE9]"))
          ) : (
            <>
              <p className="px-2.5 pb-1 pt-2 text-[12px] text-muted-foreground">{user.name} · {ROLE_LABEL[user.role] ?? user.role}</p>
              {switcher && <BusinessSwitcher current={business.id} options={switcher} className="px-2.5 pb-2" />}
              {dashboard.items.map((item) => itemLink({ ...item, icon: "🏠" }, `flex gap-2.5 rounded-[10px] px-2.5 py-3 text-[15px] ${active(item.href) ? "bg-[#FDECE9]" : "hover:bg-[#FDECE9]"}`))}
              {groups.map((g) => (
                <div key={g.label}>
                  <h4 className="mx-2 mb-1 mt-3.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{g.label}</h4>
                  {g.items.map((item) => itemLink(item, `flex gap-2.5 rounded-[10px] px-2.5 py-3 text-[15px] ${!item.external && active(item.href.split("?")[0]) ? "bg-[#FDECE9]" : "hover:bg-[#FDECE9]"}`))}
                </div>
              ))}
              <button type="button" onClick={handleLogout} className="mt-3 flex w-full gap-2.5 rounded-[10px] px-2.5 py-3 text-left text-[15px] hover:bg-[#FDECE9]">
                <span className="w-5 text-center">↩</span> Logout
              </button>
            </>
          )}
        </nav>
      </aside>

      <main className="overflow-x-hidden">{children}</main>
    </div>
  );
}
