import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { getBusiness, listBusinesses } from "@/lib/business";
import { getBusinessSetting } from "@/lib/business-settings";
import { buildDayEndReport } from "@/lib/day-end-report";
import { dayEndText, whatsAppUrl } from "@/lib/day-end-text";

// GET ?date=YYYY-MM-DD[&all=1] → the day's report as WhatsApp text and a
// link that opens WhatsApp with it (Daily accounts → "Send to WhatsApp").
// all=1 (group owner): every business in one message.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "daily_accounts", "GET")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Pick a date" }, { status: 400 });

  const all = req.nextUrl.searchParams.get("all") === "1" && !!session.owner;
  const list = all
    ? [...(await listBusinesses())].sort((a, b) => Number(b.active) - Number(a.active))
    : [await getBusiness(session.businessId)].filter((b): b is NonNullable<typeof b> => !!b);
  const parts: string[] = [];
  for (const b of list) parts.push(dayEndText(await buildDayEndReport(b.id, b.name, date)));
  const text = parts.join("\n\n— — —\n\n");
  const number = await getBusinessSetting<string>(session.businessId, "owner_whatsapp").catch(() => undefined);
  return NextResponse.json({ text, url: whatsAppUrl(text, number) });
}
