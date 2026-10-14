"use client";

import { ALLERGENS } from "@/lib/allergens";
import { ALLERGY_DISCLAIMER, type AllergyAnswer } from "@/lib/allergy";

// "Does anyone … have a food allergy?" — website checkout, QR table orders and
// table bookings (agreed 2026-10-14). No → carry on; Yes → tick the allergens
// and describe it, then carry on (the order shows an ALLERGY banner to staff).
export default function AllergyQuestion({ value, onChange, who = "in this order" }: {
  value: AllergyAnswer; onChange: (v: AllergyAnswer) => void; who?: string;
}) {
  const toggle = (a: string) => onChange({ ...value, allergens: value.allergens.includes(a) ? value.allergens.filter((x) => x !== a) : [...value.allergens, a] });
  const btn = (on: boolean, yes: boolean) => `flex-1 border px-4 py-2.5 text-sm font-semibold ${on ? (yes ? "border-amber-500 bg-amber-50 text-amber-900" : "border-primary bg-primary text-primary-foreground") : "border-border"}`;
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="font-semibold">Does anyone {who} have a food allergy? <span className="text-red-500">*</span></p>
      <div className="mt-3 flex gap-3">
        <button type="button" onClick={() => onChange({ answer: "no", allergens: [], notes: "" })} className={btn(value.answer === "no", false)}>No</button>
        <button type="button" onClick={() => onChange({ ...value, answer: "yes" })} className={btn(value.answer === "yes", true)}>Yes</button>
      </div>
      {value.answer === "yes" && (
        <div className="mt-4 space-y-3">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">⚠️ {ALLERGY_DISCLAIMER}</p>
          <div>
            <p className="mb-2 text-sm font-medium">Which allergies?</p>
            <div className="flex flex-wrap gap-2">
              {ALLERGENS.map((a) => (
                <button key={a} type="button" onClick={() => toggle(a)} aria-pressed={value.allergens.includes(a)}
                  className={`rounded-full border px-3 py-1 text-xs capitalize ${value.allergens.includes(a) ? "border-amber-500 bg-amber-100 font-semibold text-amber-900" : "border-border text-muted-foreground"}`}>
                  {value.allergens.includes(a) ? "✓ " : ""}{a}
                </button>
              ))}
            </div>
          </div>
          <textarea value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} rows={2} maxLength={500}
            placeholder="Tell us more: who, which dishes, how severe (e.g. severe peanut allergy, no nuts in anything)"
            className="w-full border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary" />
        </div>
      )}
    </div>
  );
}
