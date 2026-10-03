import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.role as string) !== "driver" && !session.deliver) return NextResponse.json({ error: "Only staff who deliver have an availability status" }, { status: 403 });

    const { status } = await req.json();
    if (!["available", "on_delivery", "offline"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const { error } = await supabase.from("staff").update({ driver_status: status }).eq("id", session.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Driver status error:", error);
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}
