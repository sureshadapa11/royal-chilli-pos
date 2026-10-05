import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb } from "@/lib/business-db";
import { canManageFinance } from "@/lib/permissions";
import { moneyOutForMonth } from "@/lib/money-out";
import { RECEIPT_BUCKET } from "@/lib/receipts";

export const maxDuration = 60;

// GET ?month=YYYY-MM → { files: [{ name, url }] } — every receipt photo for the
// month's money out, with 15-minute links. The browser zips them (a month of
// photos is far bigger than a server response may be); names match the
// "Money out" sheet of the accountant export.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageFinance(session.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month=YYYY-MM is required" }, { status: 400 });

  const rows = await moneyOutForMonth(bizDb(session.businessId), month);
  const photos = rows.flatMap((r) => r.photos);
  const files: { name: string; url: string }[] = [];
  for (let i = 0; i < photos.length; i += 100) {
    const part = photos.slice(i, i + 100);
    const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrls(part.map((p) => p.filePath), 900);
    if (error || !data) return NextResponse.json({ error: "Couldn't prepare the photos" }, { status: 500 });
    data.forEach((d, j) => { if (d.signedUrl) files.push({ name: part[j].fileName, url: d.signedUrl }); });
  }
  return NextResponse.json({ month, files, missing: rows.filter((r) => r.photos.length === 0).length });
}
