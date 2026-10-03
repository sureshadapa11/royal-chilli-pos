import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";
import { londonNowDateAndMinutes } from "@/lib/hours";
import { GRID_H, GRID_W, SHAPES, round2 } from "@/lib/floor-plan";

// Floor plan fields (lib/floor-plan.ts): where the table sits (anywhere —
// fractions of a cell are fine; a long table turned 90° can start a little
// left of the edge), its shape and its turn (45° steps).
function layoutFields(b: { pos_x?: unknown; pos_y?: unknown; shape?: unknown; rotation?: unknown }): Record<string, unknown> | { error: string } {
  const out: Record<string, unknown> = {};
  for (const [k, max] of [["pos_x", GRID_W], ["pos_y", GRID_H]] as const) {
    if (b[k] === undefined) continue;
    const v = round2(Number(b[k]));
    if (!Number.isFinite(v) || v < -10 || v >= max) return { error: "That spot is off the floor plan" };
    out[k] = v;
  }
  if (b.shape !== undefined) {
    if (!(SHAPES as readonly string[]).includes(String(b.shape))) return { error: "Unknown table shape" };
    out.shape = b.shape;
  }
  if (b.rotation !== undefined) {
    const r = Number(b.rotation);
    if (!Number.isInteger(r) || r % 45 !== 0) return { error: "Tables turn in 45° steps" };
    out.rotation = ((r % 360) + 360) % 360;
  }
  return out;
}

// A reservation counts as "coming up soon" starting this many minutes ahead
// of the booked time — mirrors the kitchen board's KITCHEN_LEAD_MINUTES
// pattern for scheduled orders. No lower bound: an overdue reservation staff
// hasn't seated or marked no-show yet keeps counting rather than quietly
// dropping off, since that's exactly the case that needs resolving.
//
// This is a plain count, not a per-table flag — a specific table is only
// ever linked to a booking at the moment it's seated (see the reservations
// page: "A table gets assigned later, when they're seated"), so there's no
// single table to point at ahead of time.
const RESERVATION_LEAD_MINUTES = 90;

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);

    const { data: tables, error } = await db
      .from("restaurant_tables")
      .select("*")
      .order("table_number");

    if (error) throw error;

    // Oldest active order per table = when it actually became occupied,
    // for the attention-SLA timer (not just the "occupied" status flag,
    // which a busy shift can forget to clear).
    const { data: activeOrders } = await db
      .from("orders")
      .select("table_id, created_at")
      .not("table_id", "is", null)
      .in("status", ["open", "sent_to_kitchen", "ready"])
      .order("created_at", { ascending: true });

    const occupiedSinceByTable = new Map<number, string>();
    for (const o of activeOrders || []) {
      if (o.table_id != null && !occupiedSinceByTable.has(o.table_id)) {
        occupiedSinceByTable.set(o.table_id, o.created_at);
      }
    }

    const { dateStr: todayStr, minutesOfDay: nowMinutes } = londonNowDateAndMinutes();
    const { data: todaysReservations } = await db
      .from("reservations")
      .select("reservation_time")
      .eq("reservation_date", todayStr)
      .in("status", ["pending", "confirmed"]);

    const upcomingReservationCount = (todaysReservations || []).filter((r) => {
      const [h, m] = r.reservation_time.split(":").map(Number);
      return h * 60 + m - nowMinutes <= RESERVATION_LEAD_MINUTES;
    }).length;

    const tablesWithTiming = (tables || []).map((t) => ({
      ...t,
      occupied_since: occupiedSinceByTable.get(t.id) ?? null,
    }));

    return NextResponse.json({ tables: tablesWithTiming, upcomingReservationCount });
  } catch (error) {
    console.error("Tables fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch tables" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !manageAllows(session.role, "tables", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);

    const body = await req.json();
    const { table_number, capacity, location } = body;
    const layout = layoutFields(body);
    if ("error" in layout) return NextResponse.json({ error: layout.error }, { status: 400 });

    const number = String(table_number ?? "").trim();
    if (!number) {
      return NextResponse.json({ error: "Table number is required" }, { status: 400 });
    }
    const seats = Math.round(Number(capacity));
    if (!Number.isFinite(seats) || seats < 1) {
      return NextResponse.json({ error: "Capacity must be at least 1" }, { status: 400 });
    }

    const { data: clash } = await db
      .from("restaurant_tables")
      .select("id")
      .eq("table_number", number)
      .maybeSingle();
    if (clash) {
      return NextResponse.json({ error: `Table "${number}" already exists` }, { status: 409 });
    }

    const { data, error } = await db
      .from("restaurant_tables")
      .insert({
        table_number: number,
        capacity: seats,
        location: location ?? "main",
        status: "available",
        ...layout,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, table: data }, { status: 201 });
  } catch (error) {
    console.error("Table create error:", error);
    return NextResponse.json(
      { error: "Failed to create table" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);

    const body = await req.json();
    const { id, status, capacity, location, table_number, self_order_enabled } = body;

    // Floor staff flip `status` all shift; changing a table's number/capacity/
    // area/spot on the floor plan is a setup action (Tables → Full).
    const editsLayout = capacity !== undefined || location !== undefined || table_number !== undefined ||
      body.pos_x !== undefined || body.pos_y !== undefined || body.shape !== undefined || body.rotation !== undefined;
    if (editsLayout && !manageAllows(session.role, "tables", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const layout = layoutFields(body);
    if ("error" in layout) return NextResponse.json({ error: layout.error }, { status: 400 });
    const updateFields: Record<string, unknown> = { ...layout };
    if (status !== undefined) updateFields.status = status;
    if (location !== undefined) updateFields.location = location;
    if (self_order_enabled !== undefined) updateFields.self_order_enabled = !!self_order_enabled;

    if (capacity !== undefined) {
      const seats = Math.round(Number(capacity));
      if (!Number.isFinite(seats) || seats < 1) {
        return NextResponse.json({ error: "Capacity must be at least 1" }, { status: 400 });
      }
      updateFields.capacity = seats;
    }

    if (table_number !== undefined) {
      const number = String(table_number).trim();
      if (!number) {
        return NextResponse.json({ error: "Table number is required" }, { status: 400 });
      }
      const { data: clash } = await db
        .from("restaurant_tables")
        .select("id")
        .eq("table_number", number)
        .neq("id", id)
        .maybeSingle();
      if (clash) {
        return NextResponse.json({ error: `Table "${number}" already exists` }, { status: 409 });
      }
      updateFields.table_number = number;
    }

    const { error } = await db
      .from("restaurant_tables")
      .update(updateFields)
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Table update error:", error);
    return NextResponse.json(
      { error: "Failed to update table" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !manageAllows(session.role, "tables", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);

    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "Table id is required" }, { status: 400 });
    }

    // orders.table_id / reservations.table_id reference this row with no ON
    // DELETE rule — a table that's ever been used can't be removed without
    // orphaning history. Rename it instead.
    const [{ count: orderCount }, { count: resvCount }] = await Promise.all([
      db.from("orders").select("id", { count: "exact", head: true }).eq("table_id", id),
      db.from("reservations").select("id", { count: "exact", head: true }).eq("table_id", id),
    ]);
    if ((orderCount ?? 0) > 0 || (resvCount ?? 0) > 0) {
      return NextResponse.json(
        { error: "This table has order or booking history, so it can't be deleted — rename it if you're rearranging." },
        { status: 409 }
      );
    }

    const { error } = await db.from("restaurant_tables").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Table delete error:", error);
    return NextResponse.json({ error: "Failed to delete table" }, { status: 500 });
  }
}
