import { ALLERGENS } from "@/lib/allergens";

// Customer allergies on an order or booking (migration 135, agreed
// 2026-10-14). Browser-safe. The customer answers "Any food allergies?":
//   No  → nothing saved beyond "asked"
//   Yes → the allergens ticked (from the 14) and a description; the order goes
//         through as normal, with an ALLERGY banner everywhere staff look.
// The kitchen can't guarantee any dish is free from allergens, so the wording
// always says so.

export type AllergyAnswer = { answer: "no" | "yes" | null; allergens: string[]; notes: string };
export const NO_ANSWER: AllergyAnswer = { answer: null, allergens: [], notes: "" };

export const ALLERGY_DISCLAIMER =
  "Our kitchen handles all 14 allergens, so we can't guarantee any dish is completely free from them. Please tell us exactly what to avoid and how severe it is.";

/** What's still missing before the customer can carry on, or null when done. */
export function allergyProblem(a: AllergyAnswer): string | null {
  if (a.answer === null) return "Please answer: does anyone in this order have a food allergy?";
  if (a.answer === "yes" && a.allergens.length === 0 && a.notes.trim().length < 3) return "Please tick the allergies or describe them.";
  return null;
}

/** The body sent to the server. */
export const allergyPayload = (a: AllergyAnswer) =>
  a.answer === "yes" ? { has: true, allergens: a.allergens, notes: a.notes.trim() } : { has: false };

/** Server side: the columns to save (allergy_allergens / allergy_notes), or an error. */
export function parseAllergy(v: unknown, required: boolean): { allergy_allergens: string[] | null; allergy_notes: string | null } | { error: string } {
  if (v == null || typeof v !== "object") {
    return required ? { error: "Please answer: does anyone in this order have a food allergy?" } : { allergy_allergens: null, allergy_notes: null };
  }
  const o = v as { has?: unknown; allergens?: unknown; notes?: unknown };
  if (!o.has) return { allergy_allergens: [], allergy_notes: null };
  const allergens = (Array.isArray(o.allergens) ? o.allergens : [])
    .map((x) => String(x).toLowerCase()).filter((x): x is (typeof ALLERGENS)[number] => (ALLERGENS as readonly string[]).includes(x));
  const notes = typeof o.notes === "string" ? o.notes.trim().slice(0, 500) : "";
  if (!allergens.length && notes.length < 3) return { error: "Please tick the allergies or describe them." };
  return { allergy_allergens: [...new Set(allergens)], allergy_notes: notes || null };
}

/** True when an order / booking has an allergy to show. */
export const hasAllergy = (r: { allergy_allergens?: string[] | null; allergy_notes?: string | null }) =>
  !!(r.allergy_allergens?.length || r.allergy_notes);

/** "Peanuts, Milk — severe, no nuts at all" */
export function allergyText(r: { allergy_allergens?: string[] | null; allergy_notes?: string | null }): string {
  const list = (r.allergy_allergens ?? []).map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join(", ");
  return [list, r.allergy_notes].filter(Boolean).join(" — ");
}

/** Two allergy answers on the same open table (QR rounds): everything from both. */
export function mergeAllergy(
  a: { allergy_allergens?: string[] | null; allergy_notes?: string | null },
  b: { allergy_allergens: string[] | null; allergy_notes: string | null },
): { allergy_allergens: string[] | null; allergy_notes: string | null } {
  if (a.allergy_allergens == null && !a.allergy_notes) return b;
  if (b.allergy_allergens == null && !b.allergy_notes) return { allergy_allergens: a.allergy_allergens ?? null, allergy_notes: a.allergy_notes ?? null };
  const allergens = [...new Set([...(a.allergy_allergens ?? []), ...(b.allergy_allergens ?? [])])];
  const notes = [a.allergy_notes, b.allergy_notes].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(" · ");
  return { allergy_allergens: allergens, allergy_notes: notes || null };
}
