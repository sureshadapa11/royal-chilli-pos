// Delivery platforms whose daily totals are typed into the Staff Hub.
// Safe to import in the browser.
export const PLATFORMS = [
  { key: "just_eat", label: "Just Eat" },
  { key: "uber_eats", label: "Uber Eats" },
  { key: "deliveroo", label: "Deliveroo" },
  { key: "hiest", label: "Hiest" },
] as const;
export type PlatformKey = (typeof PLATFORMS)[number]["key"];
