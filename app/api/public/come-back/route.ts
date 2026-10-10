import { NextRequest, NextResponse } from "next/server";
import { answerWinBack } from "@/lib/winback";
import { isWinBackReason } from "@/lib/winback-reasons";

// POST { token, reason, comment } — the customer confirmed why they stopped
// coming; they get that reason's come-back code (once per email).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!isWinBackReason(body?.reason)) return NextResponse.json({ error: "Please pick a reason" }, { status: 400 });
  const comment = typeof body?.comment === "string" ? body.comment.trim().slice(0, 1000) || null : null;
  try {
    const result = await answerWinBack(token, body.reason, comment);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ offer: result.offer });
  } catch (error) {
    console.error("Come-back answer error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
