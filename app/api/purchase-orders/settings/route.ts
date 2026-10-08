import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { saveBusinessSettings } from "@/lib/business-settings";
import { APPROVAL_LIMIT_KEY } from "@/lib/purchase-orders";
import { approvalLimit } from "@/lib/purchase-orders-server";

// The approval limit: orders over it need a manager (not the one who made
// it) or a Super admin to approve. Only a Super admin changes it — a manager
// who could raise it could skip approval.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "inventory", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ approvalLimit: await approvalLimit(session.businessId), canChange: session.owner === true });
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session.owner) return NextResponse.json({ error: "Only a Super admin can change the approval limit." }, { status: 403 });
    const { approval_limit } = await req.json();
    const limit = Number(approval_limit);
    if (!Number.isFinite(limit) || limit < 0 || limit > 100000) {
      return NextResponse.json({ error: "Enter an amount between £0 and £100,000." }, { status: 400 });
    }
    const rounded = Math.round(limit * 100) / 100;
    await saveBusinessSettings(session.businessId, { [APPROVAL_LIMIT_KEY]: rounded });
    return NextResponse.json({ success: true, approvalLimit: rounded });
  } catch (error) {
    console.error("Approval limit save error:", error);
    return NextResponse.json({ error: "Failed to save the approval limit" }, { status: 500 });
  }
}
