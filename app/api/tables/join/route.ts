import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";
import { groupsOf, planJoin } from "@/lib/floor-plan";
import { placedTables, refreshJoinLabel, type JoinRow } from "@/lib/table-joins";

// Joined tables (Staff Hub → Tables, migration 112): tables pushed together
// for a big party act as one until unjoined — orders go on the lead table,
// and the till, kitchen ticket and receipt show the lead's join_label
// ("T1 + T2 · 🎂 Birthday party").
//   POST   { lead_id, table_id }   join a table onto a lead (or a lone table)
//   PUT    { lead_id, group_name } name the group (empty clears it)
//   DELETE ?lead_id=               unjoin the whole group
// Not while any of the tables has an open order: that order would lose (or
// gain) tables mid-meal.

const OPEN_STATUSES = ["open", "sent_to_kitchen", "ready"];
type Db = ReturnType<typeof bizDb>;

async function busyTable(db: Db, ids: number[], tables: JoinRow[]) {
  const { data } = await db.from("orders").select("table_id").in("table_id", ids).in("status", OPEN_STATUSES).limit(1);
  const id = data?.[0]?.table_id;
  return id == null ? null : tables.find((t) => t.id === id)?.table_number ?? "A table";
}

async function guard(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !manageAllows(session.role, "tables", req.method)) return null;
  return bizDb(session.businessId);
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  try {
    const db = await guard(req);
    if (!db) return fail("Unauthorized", 401);
    const body = await req.json().catch(() => ({}));
    let leadId = Number(body.lead_id);
    const tableId = Number(body.table_id);
    if (!leadId || !tableId || leadId === tableId) return fail("Pick two different tables");

    const placed = await placedTables(db);
    // Joining onto a table that's itself joined means joining its group.
    const lead0 = placed.find((p) => p.id === leadId);
    if (lead0?.joined_to) leadId = lead0.joined_to;
    const group = groupsOf(placed).find((g) => g.lead.id === leadId);
    if (!group) return fail("That table isn't on the plan", 404);

    const busy = await busyTable(db, [...group.members.map((m) => m.id), tableId], placed);
    if (busy) return fail(`${busy} has an open order — join tables before seating, or after the bill is paid`, 409);

    const plan = planJoin(placed, leadId, tableId);
    if ("error" in plan) return fail(plan.error, 409);
    for (const m of plan.moves) {
      const { error } = await db.from("restaurant_tables").update({ pos_x: m.x, pos_y: m.y }).eq("id", m.id);
      if (error) throw error;
    }
    const { error } = await db.from("restaurant_tables")
      .update({ joined_to: leadId, group_name: null, join_label: null, status: "available" })
      .eq("id", tableId);
    if (error) throw error;
    await refreshJoinLabel(db, leadId);
    return NextResponse.json({ success: true, lead_id: leadId });
  } catch (error) {
    console.error("Table join error:", error);
    return fail("Failed to join tables", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const db = await guard(req);
    if (!db) return fail("Unauthorized", 401);
    const body = await req.json().catch(() => ({}));
    const leadId = Number(body.lead_id);
    const name = String(body.group_name ?? "").trim().slice(0, 40) || null;
    const { error } = await db.from("restaurant_tables").update({ group_name: name }).eq("id", leadId).is("joined_to", null);
    if (error) throw error;
    await refreshJoinLabel(db, leadId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Table group name error:", error);
    return fail("Failed to save the group name", 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = await guard(req);
    if (!db) return fail("Unauthorized", 401);
    const leadId = Number(req.nextUrl.searchParams.get("lead_id"));
    const placed = await placedTables(db);
    const group = groupsOf(placed).find((g) => g.lead.id === leadId);
    if (!group || group.members.length < 2) return fail("Those tables aren't joined", 404);

    const busy = await busyTable(db, group.members.map((m) => m.id), placed);
    if (busy) return fail(`${busy} has an open order — unjoin after the bill is paid`, 409);

    const { error } = await db.from("restaurant_tables").update({ joined_to: null }).eq("joined_to", leadId);
    if (error) throw error;
    await db.from("restaurant_tables").update({ group_name: null, join_label: null }).eq("id", leadId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Table unjoin error:", error);
    return fail("Failed to unjoin tables", 500);
  }
}
