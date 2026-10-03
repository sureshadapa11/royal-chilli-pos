import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { londonDateStr } from "@/lib/london-date";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "finance", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = db.from("expenses").select("*").order("expense_date", { ascending: false });
  if (from) query = query.gte("expense_date", from);
  if (to) query = query.lte("expense_date", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to fetch expenses" }, { status: 500 });
  return NextResponse.json({ expenses: data });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "finance", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { category, description, amount, vat_applicable, expense_date, receipt_reference, allow_duplicate } = await req.json();
    if (!category || !description || !amount) {
      return NextResponse.json({ error: "category, description and amount are required" }, { status: 400 });
    }
    if (!(Number(amount) > 0)) return NextResponse.json({ error: "Amount must be more than £0" }, { status: 400 });

    // Same expense typed twice would be counted twice in the P&L — ask first.
    if (!allow_duplicate) {
      const { data: same } = await db.from("expenses").select("id")
        .eq("expense_date", expense_date || londonDateStr()).eq("category", category)
        .eq("amount", Math.round(Number(amount) * 100) / 100).ilike("description", String(description).trim()).limit(1);
      if (same && same.length > 0) {
        return NextResponse.json({ error: "This expense is already recorded for that day", duplicate: true }, { status: 409 });
      }
    }

    const { data, error } = await db
      .from("expenses")
      .insert({
        category, description: String(description).trim(), amount: Math.round(Number(amount) * 100) / 100,
        vat_applicable: vat_applicable === undefined ? 1 : Number(vat_applicable),
        expense_date: expense_date || londonDateStr(),
        receipt_reference: receipt_reference || null,
        recorded_by: session.id,
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, expense: data }, { status: 201 });
  } catch (error) {
    console.error("Expense create error:", error);
    return NextResponse.json({ error: "Failed to create expense" }, { status: 500 });
  }
}
