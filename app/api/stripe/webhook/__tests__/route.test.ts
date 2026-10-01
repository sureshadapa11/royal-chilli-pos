// Verifies the idempotency guard added alongside the webhook signature check:
// a redelivered checkout.session.completed event for an order that already
// has a payment recorded under that session id must not insert a second
// payment row.
type Row = Record<string, unknown>;

let insertedPayments: Row[];
let existingPaymentForReference: Row | null;
let orderRow: Row | null;

const fakeEvent = {
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_123",
      amount_total: 2500,
      metadata: { type: "order", order_id: "7" },
    },
  },
};

jest.mock("@/lib/stripe", () => ({
  __esModule: true,
  stripe: {
    webhooks: {
      constructEvent: jest.fn(() => fakeEvent),
    },
  },
}));

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.neq = () => builder;
      builder.limit = () => builder;
      builder.single = () => Promise.resolve({ data: orderRow, error: null });
      builder.maybeSingle = () => Promise.resolve({ data: existingPaymentForReference, error: null });
      builder.insert = (vals: Row) => {
        if (table === "payments") insertedPayments.push(vals);
        return Promise.resolve({ data: null, error: null });
      };
      builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return builder;
    },
  },
}));

import { POST } from "@/app/api/stripe/webhook/route";

function webhookRequest() {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "test-sig" },
    body: JSON.stringify(fakeEvent),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  insertedPayments = [];
  existingPaymentForReference = null;
  orderRow = { business_id: 1, amount_paid: 0, total: 25 };
});

describe("POST /api/stripe/webhook — idempotency", () => {
  it("records a payment on first delivery", async () => {
    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(insertedPayments).toHaveLength(1);
    expect(insertedPayments[0]).toMatchObject({ order_id: 7, amount: 25, reference: "cs_test_123" });
  });

  it("does not insert a second payment when the same event is redelivered", async () => {
    existingPaymentForReference = { id: 1 };
    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(insertedPayments).toHaveLength(0);
  });

  it("does not insert once the order is already fully paid, even without a reference match", async () => {
    orderRow = { business_id: 1, amount_paid: 25, total: 25 };
    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(insertedPayments).toHaveLength(0);
  });
});
