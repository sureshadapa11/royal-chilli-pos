import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

// PATCH { action: "decline", reason } — a manager says no (reason required).
// PATCH { action: "withdraw" } — the person who asked takes it back.
// Only while the request is still open.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const db = bizDb(session.businessId);
    const { id } = await params;
    const { action, reason } = await req.json();

    const { data: request } = await db.from("stock_requests").select("id, status, requested_by").eq("id", id).maybeSingle();
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });

    let declineReason: string;
    if (action === "decline") {
      if (!areaAllows(session.role, "inventory", req.method)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      declineReason = typeof reason === "string" ? reason.trim().slice(0, 200) : "";
      if (!declineReason) return NextResponse.json({ error: "Say why, so the kitchen knows." }, { status: 400 });
    } else if (action === "withdraw") {
      if (request.requested_by !== session.id) return NextResponse.json({ error: "Only the person who asked can take it back." }, { status: 403 });
      declineReason = "Withdrawn";
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const { data, error } = await db.from("stock_requests")
      .update({ status: "declined", decline_reason: declineReason, handled_by: session.id, handled_at: new Date().toISOString() })
      .eq("id", id).eq("status", "open")
      .select().maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "This request has already been dealt with." }, { status: 409 });
    return NextResponse.json({ success: true, request: data });
  } catch (error) {
    console.error("Stock request update error:", error);
    return NextResponse.json({ error: "Failed to update the request" }, { status: 500 });
  }
}
