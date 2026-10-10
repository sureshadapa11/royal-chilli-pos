// The delivery platforms on the dashboard cards, in order. Safe to import in the browser.
export const CARD_PLATFORMS = [
  { key: "just_eat", label: "Just Eat" },
  { key: "deliveroo", label: "Deliveroo" },
  { key: "uber_eats", label: "Uber Eats" },
  { key: "hiest", label: "Hiest" },
] as const;
export type CardPlatform = (typeof CARD_PLATFORMS)[number]["key"];
