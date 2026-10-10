import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { sendWeeklyReports } from "@/lib/weekly-report";

// Monday morning: last week's sales, profit and guest feedback, emailed to
// each open business (lib/weekly-report.ts).
export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ sent: await sendWeeklyReports() });
}
