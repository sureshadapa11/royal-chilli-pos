import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { manageAllows } from "@/lib/permissions";
import { stripe, TERMINAL_LOCATION_ADDRESS } from "@/lib/stripe";
import { pairReader } from "@/lib/sumup";
import { getBusinessSetting, saveBusinessSettings } from "@/lib/business-settings";
import { getBrand } from "@/lib/brand";

type PairedReader = { id: string; label: string | null; status: string | null };

// One-time setup: registers the till's card reader. For a SumUp Solo
// (provider "sumup"), the pairing code is shown on the Solo under
// Connections → API → Connect and expires after 5 minutes.
//
// For a Stripe Terminal reader:
// Stripe requires every reader to belong to a Terminal "Location", so this
// lazily creates one (from the fixed premises address in lib/stripe.ts) the
// first time and reuses its id after. The registration_code is shown ON THE
// READER during its pairing flow and is single-use / short-lived, so this
// runs while someone is standing at the device. The returned id goes into the
// "Card Reader ID" field in Settings.
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !manageAllows(session.role, "settings", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { registration_code, label, provider } = await req.json();
    if (!registration_code || !label) {
      return NextResponse.json({ error: "registration_code and label are required" }, { status: 400 });
    }

    if (provider === "sumup") {
      const reader = await pairReader(String(registration_code).trim(), String(label).trim());
      const paired: PairedReader = { id: reader.id, label: reader.name, status: reader.status };
      return NextResponse.json({ reader: paired });
    }

    if (!stripe) {
      return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
    }

    // --- ensure a Terminal Location exists ---
    let locationId = String((await getBusinessSetting(session.businessId, "stripe_terminal_location_id")) ?? "").trim();

    if (!locationId) {
      const location = await stripe.terminal.locations.create({
        display_name: (await getBrand(session.businessId)).name || "Till",
        address: { ...TERMINAL_LOCATION_ADDRESS },
      });
      locationId = location.id;
      await saveBusinessSettings(session.businessId, { stripe_terminal_location_id: locationId });
    }

    const reader = await stripe.terminal.readers.create({
      registration_code: String(registration_code).trim(),
      label: String(label).trim(),
      location: locationId,
    });

    const paired: PairedReader = { id: reader.id, label: reader.label, status: reader.status };
    return NextResponse.json({ reader: paired });
  } catch (error) {
    console.error("Reader pairing error:", error);
    const message = error instanceof Error ? error.message : "Failed to pair reader";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
