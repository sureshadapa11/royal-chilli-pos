"use client";

import { useEffect, useState } from "react";
import type { AccountsAccess, AccountsTab } from "@/lib/accounts-access";
import DailyAccountsView from "@/components/staff/DailyAccountsView";
import DailyAccountsMonth from "@/components/staff/DailyAccountsMonth";
import CashMovementsMonth from "@/components/staff/CashMovementsMonth";
import CashBookMonth from "@/components/staff/CashBookMonth";
import SalaryMonth from "@/components/staff/SalaryMonth";
import CateringJobsMonth from "@/components/staff/CateringJobsMonth";

// Staff Hub → Daily accounts: Day (fill in the day-end sheet), Month (the
// whole month like the paper report), Money in/out, Cash book and Salary.
// The tab bar (agreed 2026-10-13) sits in one fixed place on its own row,
// sticks under the top bar when scrolling, and carries the one month picker
// every month tab shares. Tab and month live in the address (?tab=&month=),
// so a refresh, the back button or a business switch keeps them; a new
// visit (no ?tab) opens on Day.
const heading = { fontFamily: "var(--font-space-grotesk)" };

type View = AccountsTab;
const LABELS: Record<View, string> = { day: "Day", month: "Month", jobs: "Catering & events", cash: "Money in/out", book: "Cash book", salary: "Salary" };
const ORDER: View[] = ["day", "month", "jobs", "cash", "book", "salary"];

const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default function DailyAccountsPage({ today, start, startMonth, startView, businessName, access }: {
  today: string; start: string; startMonth: string; startView: AccountsTab; businessName: string; access: AccountsAccess;
}) {
  const tabs = ORDER.filter((t) => access.tabs.includes(t));
  const [view, setView] = useState<View>(startView);
  const [day, setDay] = useState(start);
  const [month, setMonth] = useState(startMonth);
  const thisMonth = today.slice(0, 7);

  // Keep the tab and month in the address without reloading the page.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", view);
    if (view === "day") { url.searchParams.delete("month"); if (day === today) url.searchParams.delete("date"); else url.searchParams.set("date", day); }
    else { url.searchParams.set("month", month); url.searchParams.delete("date"); }
    window.history.replaceState(window.history.state, "", url.toString());
  }, [view, month, day, today]);

  return (
    <div className="px-4 py-6 md:px-6 md:py-7">
      <div className="mx-auto max-w-[1500px]">
        <h1 style={heading} className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">Daily accounts</h1>

        {/* One fixed place for the tabs, stuck under the top bar while scrolling. */}
        <div className="sticky z-30 -mx-4 mt-3 bg-background px-4 py-2 md:-mx-6 md:px-6 print:hidden" style={{ top: "var(--staff-bar-h, 0px)" }}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div role="tablist" aria-label="Daily accounts" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[#F6F1E6] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tabs.map((v) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                  className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-1.5 text-[13.5px] font-semibold ${view === v ? "bg-[#E34435] text-white" : "text-[#5B524B] hover:bg-white/60"}`}>
                  {LABELS[v]}
                </button>
              ))}
            </div>
            {view !== "day" && (
              <div className="flex items-center gap-1.5 sm:ml-auto">
                <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"
                  className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-white text-[15px] hover:bg-surface-hover">‹</button>
                <label className="relative">
                  <span className="block min-w-[128px] rounded-lg border border-border bg-white px-3 py-1.5 text-center text-[13.5px] font-semibold">{monthLabel(month)}</span>
                  <input type="month" value={month} max={thisMonth} onChange={(e) => e.target.value && setMonth(e.target.value)}
                    aria-label="Month" className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
                <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth} aria-label="Next month"
                  className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-white text-[15px] hover:bg-surface-hover disabled:opacity-40">›</button>
              </div>
            )}
          </div>
        </div>

        <div className={`mt-5 ${view === "month" ? "" : "max-w-[900px]"}`}>
          {view === "day"
            ? <DailyAccountsView key={day} today={today} start={day} seeFigures={access.seeFigures} />
            : view === "jobs" ? <CateringJobsMonth month={month} today={today} canEnter={access.canEnter} canCorrect={access.canCorrect} canDelete={access.canDelete} />
            : view === "cash" ? <CashMovementsMonth startMonth={month} sharedMonth={month} canDelete={access.canDelete} />
            : view === "book" ? <CashBookMonth startMonth={month} sharedMonth={month} />
            : view === "salary" && tabs.includes("salary") ? <SalaryMonth startMonth={month} sharedMonth={month} />
            : <DailyAccountsMonth startMonth={month} sharedMonth={month} businessName={businessName} onOpenDay={(d) => { setDay(d > today ? today : d); setView("day"); }} />}
        </div>
      </div>
    </div>
  );
}
