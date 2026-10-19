import { getBusinessSetting } from "@/lib/business-settings";

export type DayHours = { day: string; open: string; close: string };

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Each business's opening hours (Settings → General): shown on its website
// (footer, homepage badge, FAQ, schema.org) and — via lib/hours.ts — when it
// takes orders and bookings.
export async function getOpeningHours(businessId: number): Promise<DayHours[]> {
  const value = await getBusinessSetting(businessId, "opening_hours");
  const hours = (value as DayHours[] | undefined) ?? [];
  return [...hours].sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
}

export function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatDayHours(h: DayHours): string {
  return `${formatTime12h(h.open)} – ${formatTime12h(h.close)}`;
}

// "Every day · 9:00 AM – 1:00 AM" when every day matches (the common case);
// otherwise runs of days with the same hours are grouped, e.g.
// "Monday – Friday · 9:00 AM – 12:00 AM" and "Saturday – Sunday · 8:00 AM – 12:00 AM".
export function summarizeOpeningHours(hours: DayHours[]): { day: string; time: string }[] {
  if (hours.length === 7 && hours.every((h) => h.open === hours[0].open && h.close === hours[0].close)) {
    return [{ day: "Every day", time: formatDayHours(hours[0]) }];
  }
  const out: { day: string; time: string; first: string; last: string }[] = [];
  for (const h of hours) {
    const time = formatDayHours(h);
    const prev = out[out.length - 1];
    // Only days next to each other in the week join a run.
    if (prev && prev.time === time && DAY_ORDER.indexOf(h.day) === DAY_ORDER.indexOf(prev.last) + 1) prev.last = h.day;
    else out.push({ day: h.day, time, first: h.day, last: h.day });
  }
  return out.map((r) => ({ day: r.first === r.last ? r.first : `${r.first} – ${r.last}`, time: r.time }));
}
