import { cleanReceivedLine } from "../purchase-orders";

describe("cleanReceivedLine", () => {
  it("keeps a full line", () => {
    expect(cleanReceivedLine({ item_id: 4, received_quantity: 18, expiry_date: "2026-10-17" }))
      .toEqual({ item_id: 4, received_quantity: 18, expiry_date: "2026-10-17" });
  });

  it("treats a missing quantity and date as 'arrived as ordered'", () => {
    expect(cleanReceivedLine({ item_id: "4", received_quantity: "", expiry_date: undefined })).toEqual({ item_id: 4 });
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
