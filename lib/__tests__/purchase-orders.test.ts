import { cleanPoLines, cleanReceivedLine, needsApproval, planPoAction, suggestOrder, type PoActor } from "../purchase-orders";

describe("cleanReceivedLine", () => {
  it("keeps a full line", () => {
    expect(cleanReceivedLine({ item_id: 4, received_quantity: 18, expiry_date: "2026-10-17" }))
      .toEqual({ item_id: 4, received_quantity: 18, expiry_date: "2026-10-17" });
  });

  it("treats a missing quantity and date as 'arrived as ordered'", () => {
    expect(cleanReceivedLine({ item_id: "4", received_quantity: "", expiry_date: undefined })).toEqual({ item_id: 4 });
  });

  it("keeps the invoice price", () => {
    expect(cleanReceivedLine({ item_id: 4, unit_cost: "6.40" })).toEqual({ item_id: 4, unit_cost: 6.4 });
    expect(cleanReceivedLine({ item_id: 4, unit_cost: 0 })).toBeNull();
  });

  it("keeps what was refused, with a reason", () => {
    expect(cleanReceivedLine({ item_id: 4, received_quantity: 20, rejected_quantity: 2, rejection_reason: "damaged" }))
      .toEqual({ item_id: 4, received_quantity: 20, rejected_quantity: 2, rejection_reason: "damaged" });
    expect(cleanReceivedLine({ item_id: 4, received_quantity: 20, rejected_quantity: 0, rejection_reason: "" })).toEqual({ item_id: 4, received_quantity: 20 });
  });

  it.each([
    [{ item_id: 4, received_quantity: 20, rejected_quantity: 2 }],
    [{ item_id: 4, received_quantity: 20, rejected_quantity: 2, rejection_reason: "smelly" }],
    [{ item_id: 4, received_quantity: 1, rejected_quantity: 2, rejection_reason: "damaged" }],
    [{ item_id: 4, received_quantity: 1, rejected_quantity: -1, rejection_reason: "damaged" }],
  ])("refuses a bad rejection %j", (raw) => {
    expect(cleanReceivedLine(raw)).toBeNull();
  });

  it("accepts zero (nothing arrived)", () => {
    expect(cleanReceivedLine({ item_id: 4, received_quantity: 0 })).toEqual({ item_id: 4, received_quantity: 0 });
  });

  it.each([
    [null],
    [{ item_id: 0 }],
    [{ item_id: "abc" }],
    [{ item_id: 4, received_quantity: -1 }],
    [{ item_id: 4, received_quantity: "lots" }],
    [{ item_id: 4, expiry_date: "17/10/2026" }],
    [{ item_id: 4, expiry_date: "2026-13-45" }],
  ])("rejects %j", (raw) => {
    expect(cleanReceivedLine(raw)).toBeNull();
  });
});

describe("needsApproval", () => {
  it("is over the limit only", () => {
    expect(needsApproval(150, 150)).toBe(false);
    expect(needsApproval(150.01, 150)).toBe(true);
    expect(needsApproval(120, 150)).toBe(false);
  });
});

describe("planPoAction", () => {
  const chef: PoActor = { id: 22, owner: false, canApprove: false };
  const manager: PoActor = { id: 1, owner: false, canApprove: true };
  const otherManager: PoActor = { id: 29, owner: false, canApprove: true };
  const superAdmin: PoActor = { id: 25, owner: true, canApprove: true };
  const po = (status: string, total: number, created_by = 1) => ({ status, total_cost: total, created_by });

  it("approves a small order on submit", () => {
    expect(planPoAction(po("draft", 120), "submit", manager, 150)).toEqual({ ok: true, from: ["draft"], to: "approved", event: "auto_approved" });
  });

  it("sends a big order for approval", () => {
    expect(planPoAction(po("draft", 200), "submit", manager, 150)).toMatchObject({ ok: true, to: "awaiting_approval", event: "submitted" });
  });

  it("lets a Super admin's own big order through", () => {
    expect(planPoAction(po("draft", 900, 25), "submit", superAdmin, 150)).toMatchObject({ ok: true, to: "approved" });
  });

  it("won't let a manager approve their own order", () => {
    expect(planPoAction(po("awaiting_approval", 200, 1), "approve", manager, 150)).toMatchObject({ ok: false, status: 403 });
  });

  it("lets another manager or a Super admin approve", () => {
    expect(planPoAction(po("awaiting_approval", 200, 1), "approve", otherManager, 150)).toMatchObject({ ok: true, to: "approved" });
    expect(planPoAction(po("awaiting_approval", 200, 25), "approve", superAdmin, 150)).toMatchObject({ ok: true, to: "approved" });
  });

  it("needs the approve tick", () => {
    expect(planPoAction(po("awaiting_approval", 200, 1), "approve", chef, 150)).toMatchObject({ ok: false, status: 403 });
  });

  it("needs a reason to reject", () => {
    expect(planPoAction(po("awaiting_approval", 200), "reject", otherManager, 150, " ")).toMatchObject({ ok: false, status: 400 });
    expect(planPoAction(po("awaiting_approval", 200), "reject", otherManager, 150, "Too much lamb")).toMatchObject({ ok: true, to: "rejected" });
  });

  it("only marks an approved order as sent", () => {
    expect(planPoAction(po("approved", 200), "mark_sent", manager, 150)).toMatchObject({ ok: true, to: "ordered" });
    expect(planPoAction(po("awaiting_approval", 200), "mark_sent", manager, 150)).toMatchObject({ ok: false, status: 409 });
  });

  it("cancels open orders but never a received one", () => {
    for (const s of ["draft", "awaiting_approval", "approved", "ordered"]) {
      expect(planPoAction(po(s, 200), "cancel", manager, 150)).toMatchObject({ ok: true, to: "cancelled" });
    }
    expect(planPoAction(po("received", 200), "cancel", manager, 150)).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses to approve twice", () => {
    expect(planPoAction(po("approved", 200, 1), "approve", otherManager, 150)).toMatchObject({ ok: false, status: 409 });
  });

  it("rejects unknown actions", () => {
    expect(planPoAction(po("draft", 1), "receive", manager, 150)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("suggestOrder", () => {
  const base = { unit: "kg", supplier_id: 3, cost_per_unit: 6, reorder_quantity: 0 };

  it("suggests low items: reorder qty, or back to twice the level", () => {
    const lines = suggestOrder([
      { ...base, id: 1, name: "Chicken Breast", current_stock: 12, reorder_level: 15 },
      { ...base, id: 2, name: "Lamb", current_stock: 2, reorder_level: 5, reorder_quantity: 10 },
      { ...base, id: 3, name: "Rice", current_stock: 40, reorder_level: 10 },
    ], new Map());
    expect(lines.map((l) => [l.name, l.quantity])).toEqual([["Chicken Breast", 18], ["Lamb", 10]]);
  });

  it("counts what's already on order", () => {
    const lines = suggestOrder([{ ...base, id: 1, name: "Chicken Breast", current_stock: 12, reorder_level: 15 }], new Map([[1, 20]]));
    expect(lines).toEqual([]);
  });

  it("ignores items with no reorder level", () => {
    expect(suggestOrder([{ ...base, id: 1, name: "Salt", current_stock: 0, reorder_level: 0 }], new Map())).toEqual([]);
  });
});

describe("cleanPoLines", () => {
  it("keeps good lines", () => {
    expect(cleanPoLines([{ ingredient_id: "1", quantity: "20", unit_cost: 6 }])).toEqual({ ok: true, lines: [{ ingredient_id: 1, quantity: 20, unit_cost: 6 }] });
  });
  it.each([
    [[]],
    ["nope"],
    [[{ ingredient_id: 1, quantity: 0, unit_cost: 6 }]],
    [[{ ingredient_id: 1, quantity: 2, unit_cost: -1 }]],
    [[{ ingredient_id: 1, quantity: 2, unit_cost: 0 }]],
    [[{ ingredient_id: 1, quantity: 2 }]],
    [[{ ingredient_id: 0, quantity: 2, unit_cost: 1 }]],
    [[{ ingredient_id: 1, quantity: 2, unit_cost: 1 }, { ingredient_id: 1, quantity: 3, unit_cost: 1 }]],
  ])("refuses %j", (raw) => {
    expect(cleanPoLines(raw).ok).toBe(false);
  });
});
