import { parseAllergy, allergyProblem, allergyText, mergeAllergy, hasAllergy } from "@/lib/allergy";

describe("customer allergies (135)", () => {
  it("requires an answer where asked, but not on the till", () => {
    expect(parseAllergy(undefined, true)).toEqual({ error: expect.any(String) });
    expect(parseAllergy(undefined, false)).toEqual({ allergy_allergens: null, allergy_notes: null });
  });
  it("No = asked, nothing to show", () => {
    const a = parseAllergy({ has: false }, true);
    expect(a).toEqual({ allergy_allergens: [], allergy_notes: null });
    expect(hasAllergy(a as { allergy_allergens: string[] })).toBe(false);
  });
  it("Yes keeps only the 14 allergens, and needs a tick or a description", () => {
    expect(parseAllergy({ has: true, allergens: ["Nuts", "bogus", "milk"], notes: " severe " }, true))
      .toEqual({ allergy_allergens: ["nuts", "milk"], allergy_notes: "severe" });
    expect(parseAllergy({ has: true, allergens: [], notes: "" }, true)).toEqual({ error: expect.any(String) });
    expect(allergyProblem({ answer: null, allergens: [], notes: "" })).not.toBeNull();
    expect(allergyProblem({ answer: "yes", allergens: ["nuts"], notes: "" })).toBeNull();
  });
  it("reads well and merges rounds on one table", () => {
    expect(allergyText({ allergy_allergens: ["peanuts", "milk"], allergy_notes: "severe" })).toBe("Peanuts, Milk — severe");
    expect(mergeAllergy({ allergy_allergens: ["nuts"], allergy_notes: "a" }, { allergy_allergens: ["milk", "nuts"], allergy_notes: "b" }))
      .toEqual({ allergy_allergens: ["nuts", "milk"], allergy_notes: "a · b" });
  });
});
