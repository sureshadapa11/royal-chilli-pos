import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { sendReservationConfirmationEmail } from "@/lib/email";
import { isValidEmail, isValidUkMobile } from "@/lib/utils";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    const from = searchParams.get("from");
    const status = searchParams.get("status");

    let query = db
      .from("reservations")
      .select(`
        *,
        restaurant_tables(table_number)
      `)
      .order("reservation_date")
      .order("reservation_time");

    if (date) {
      query = query.eq("reservation_date", date);
    } else if (from) {
      // "Upcoming" view — everything from this date onward, no end cutoff.
      query = query.gte("reservation_date", from);
    }

    if (status) {
      query = query.eq("status", status);
    }

    const { data: reservations, error } = await query;
    if (error) throw error;

    const flat = (reservations ?? []).map((r) => {
      const { restaurant_tables: rt, ...rest } = r as typeof r & {
        restaurant_tables: { table_number: string } | null;
      };
      return { ...rest, table_number: rt?.table_number ?? null };
    });

    return NextResponse.json({ reservations: flat });
  } catch (error) {
    console.error("Reservations fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch reservations" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Kitchen staff work the Kitchen Display only.
    if (session.role === "kitchen") {
      return NextResponse.json({ error: "Kitchen staff can't make or change bookings." }, { status: 403 });
    }
    const db = bizDb(session.businessId);

    const body = await req.json();
    const {
      customer_name,
      customer_phone,
      customer_email,
      party_size,
      reservation_date,
      reservation_time,
      table_id,
      notes,
      source,
    } = body;

    if (!customer_name || !customer_phone || !customer_email || !reservation_date || !reservation_time) {
      return NextResponse.json(
        { error: "Customer name, phone, email, date, and time are required" },
        { status: 400 }
      );
    }
    if (!isValidUkMobile(customer_phone)) {
      return NextResponse.json({ error: "Please enter a valid UK mobile number (starts with 07, 11 digits)" }, { status: 400 });
    }
    if (!isValidEmail(customer_email)) {
      return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
    }

    if (table_id && !(await allOwned(db, "restaurant_tables", [table_id]))) {
      return NextResponse.json({ error: "That table isn't this business's" }, { status: 400 });
    }

    const { data, error } = await db
      .from("reservations")
      .insert({
        customer_name,
        customer_phone: customer_phone || null,
        customer_email,
        party_size: party_size ?? 2,
        reservation_date,
        reservation_time,
        table_id: table_id || null,
        notes: notes || null,
        source: source || "website",
        status: "pending",
      })
      .select()
      .single();

    if (error) throw error;

    waitUntil(sendReservationConfirmationEmail(customer_email, {
      customerName: customer_name,
      partySize: party_size ?? 2,
      reservationDate: reservation_date,
      reservationTime: reservation_time,
      waitlisted: false,
      depositAmount: 0,
    }));

    return NextResponse.json({ success: true, reservation: data }, { status: 201 });
  } catch (error) {
    console.error("Reservation create error:", error);
    return NextResponse.json(
      { error: "Failed to create reservation" },
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
    // Kitchen staff work the Kitchen Display only.
    if (session.role === "kitchen") {
      return NextResponse.json({ error: "Kitchen staff can't make or change bookings." }, { status: 403 });
    }
    const db = bizDb(session.businessId);

    const { id, status, table_id, notes } = await req.json();

    if (!id || !status) {
      return NextResponse.json(
        { error: "Reservation ID and status are required" },
        { status: 400 }
      );
    }

    const validStatuses = ["pending", "confirmed", "seated", "cancelled", "no_show", "waitlisted"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
      );
    }

    if (table_id && !(await allOwned(db, "restaurant_tables", [table_id]))) {
      return NextResponse.json({ error: "That table isn't this business's" }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = { status };
    if (table_id !== undefined) updatePayload.table_id = table_id;
    if (notes !== undefined) updatePayload.notes = notes;

    const { data, error } = await db
      .from("reservations")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // Update table status based on reservation status
    const reservation = data as { table_id: number | null };
    if (reservation.table_id) {
      if (status === "seated") {
        await db
          .from("restaurant_tables")
          .update({ status: "occupied" })
          .eq("id", reservation.table_id);
      } else if (status === "cancelled" || status === "no_show") {
        await db
          .from("restaurant_tables")
          .update({ status: "available", self_order_enabled: false })
          .eq("id", reservation.table_id);
      }
    }

    return NextResponse.json({ success: true, reservation: data });
  } catch (error) {
    console.error("Reservation update error:", error);
    return NextResponse.json(
      { error: "Failed to update reservation" },
      { status: 500 }
    );
  }
}
