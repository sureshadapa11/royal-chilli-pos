import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { sendDayEndReports } from "@/lib/day-end-report";

// Every morning: yesterday's Day End, cash drawer and Cash In / Out, emailed
// to each business's "day_end_report_to" (lib/day-end-report.ts).
export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ sent: await sendDayEndReports() });
}
