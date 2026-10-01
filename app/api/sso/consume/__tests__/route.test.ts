import { NextRequest } from "next/server";

jest.mock("jose", () => ({ jwtVerify: jest.fn() }));
jest.mock("@/lib/auth", () => ({
  createSession: jest.fn().mockResolvedValue("session-token"),
  getSessionCookieOptions: jest.fn().mockReturnValue({ httpOnly: true }),
}));
jest.mock("@/lib/business", () => ({
  getBusiness: jest.fn(),
  staffHome: jest.fn(),
}));

import { jwtVerify } from "jose";
import { createSession } from "@/lib/auth";
import { getBusiness, staffHome } from "@/lib/business";
import { GET } from "@/app/api/sso/consume/route";

const jwtVerifyMock = jwtVerify as jest.Mock;
const createSessionMock = createSession as jest.Mock;
const getBusinessMock = getBusiness as jest.Mock;
const staffHomeMock = staffHome as jest.Mock;

function request() {
  return new NextRequest("https://pos.example/api/sso/consume?token=signed-token");
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    name: "A Manager",
    role: "manager",
    bid: 2,
    purpose: "sso",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jwtVerifyMock.mockResolvedValue({ payload: payload() });
  getBusinessMock.mockResolvedValue({ id: 2 });
  staffHomeMock.mockResolvedValue({ businessId: 2, isOwner: false });
});

describe("GET /api/sso/consume", () => {
  it("creates a session for the signed business after validating staff assignment", async () => {
    const response = await GET(request());

    expect(response.headers.get("location")).toBe("https://pos.example/staff");
    expect(createSessionMock).toHaveBeenCalledWith({
      id: 12,
      name: "A Manager",
      role: "manager",
      businessId: 2,
    });
    expect(staffHomeMock).toHaveBeenCalledWith(12);
  });

  it("rejects a token without a valid business id instead of defaulting to business 1", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: payload({ bid: undefined }) });

    const response = await GET(request());

    expect(response.headers.get("location")).toBe("https://pos.example/login");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("rejects a business that the staff member is not assigned to", async () => {
    staffHomeMock.mockResolvedValue({ businessId: 1, isOwner: false });

    const response = await GET(request());

    expect(response.headers.get("location")).toBe("https://pos.example/login");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("allows the group owner to use any existing business in the token", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: payload({ own: true }) });
    staffHomeMock.mockResolvedValue({ businessId: null, isOwner: true });

    const response = await GET(request());

    expect(response.headers.get("location")).toBe("https://pos.example/staff");
    expect(createSessionMock).toHaveBeenCalledWith(expect.objectContaining({ businessId: 2, owner: true }));
  });
});
