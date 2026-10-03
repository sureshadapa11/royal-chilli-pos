"use client";

import { useState } from "react";
import DailyAccountsView from "@/components/staff/DailyAccountsView";
import DailyAccountsMonth from "@/components/staff/DailyAccountsMonth";

// Staff Hub → Daily accounts: Day (fill in the day-end sheet) and Month (the
// whole month like the paper report, with totals, Excel and PDF).
const heading = { fontFamily: "var(--font-space-grotesk)" };

export default function DailyAccountsPage({ today, start, startMonth, startView, businessName }: {
  today: string; start: string; startMonth: string; startView: "day" | "month"; businessName: string;
}) {
  const [view, setView] = useState(startView);
  const [day, setDay] = useState(start);
  const tab = (v: "day" | "month", label: string) => (
    <button type="button" onClick={() => setView(v)} aria-pressed={view === v}
      className={`rounded-lg px-4 py-1.5 text-[13.5px] font-semibold ${view === v ? "bg-[#E34435] text-white" : "text-[#5B524B] hover:bg-[#F6F1E6]"}`}>
      {label}
    </button>
  );

  return (
    <div className="px-4 py-6 md:px-6 md:py-7">
      <div className={`mx-auto ${view === "month" ? "max-w-[1500px]" : "max-w-[900px]"}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 style={heading} className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">Daily accounts</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {view === "day"
                ? "The day-end sheet. Till figures are filled in for you — check them, add bank in, catering and any notes, then submit."
                : "The whole month, like the paper report — with totals, Excel download and print."}
            </p>
          </div>
          <div className="flex gap-1 rounded-xl bg-[#F6F1E6] p-1">{tab("day", "Day")}{tab("month", "Month")}</div>
        </div>
        <div className="mt-5">
          {view === "day"
            ? <DailyAccountsView key={day} today={today} start={day} />
            : <DailyAccountsMonth startMonth={startMonth} businessName={businessName} onOpenDay={(d) => { setDay(d > today ? today : d); setView("day"); }} />}
        </div>
      </div>
    </div>
  );
}
