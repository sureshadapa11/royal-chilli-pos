import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { DOC_TYPE_LABEL } from "@/lib/employee-documents";
import { londonDateStr } from "@/lib/london-date";
import { SITE_URL } from "@/lib/site-url";

// Daily sweep of employee_documents.expiry_date — any document with an
// expiry (right-to-work, visa/BRP, certificate, contract review, etc, not
// RTW-specific). Fires at 60/30/7 days out, tracked per-document so the
// same threshold never re-notifies. Writes into the SAME `notifications`
// table the attendance app already reads (shared Supabase, migration 033),
// so this needs no new UI: the employee sees a generic heads-up next time
// they open the attendance app, managers/HR see the specific one — both
// already have a working notification bell there, Staff Hub doesn't.

const THRESHOLDS = [
  { days: 60, column: "reminder_60_sent" as const },
  { days: 30, column: "reminder_30_sent" as const },
  { days: 7, column: "reminder_7_sent" as const },
];

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const todayStr = londonDateStr();
  const farthest = new Date();
  farthest.setDate(farthest.getDate() + 60);

  const { data: docs, error } = await supabase
    .from("employee_documents")
    .select("id, staff_id, doc_type, expiry_date, reminder_60_sent, reminder_30_sent, reminder_7_sent")
    .not("expiry_date", "is", null)
    .lte("expiry_date", farthest.toISOString().slice(0, 10));
  if (error) return NextResponse.json({ error: "Failed to load documents" }, { status: 500 });
  if (!docs || docs.length === 0) return NextResponse.json({ processed: 0 });

  const { data: managers } = await supabase
    .from("staff")
    .select("id")
    .eq("active", 1)
    .in("role", ["supervisor", "manager", "hr", "admin"]);
  const { data: staffRows } = await supabase.from("staff").select("id, name").in(
    "id",
    docs.map((d) => d.staff_id),
  );
  const nameById = new Map((staffRows ?? []).map((s) => [s.id, s.name]));

  const notifications: { staff_id: number; type: string; message: string; link?: string }[] = [];
  const updates: { id: number; column: string }[] = [];

  for (const doc of docs) {
    const daysLeft = Math.floor((new Date(doc.expiry_date).getTime() - Date.now()) / 86_400_000);
    for (const t of THRESHOLDS) {
      if (daysLeft > t.days) continue;
      if (doc[t.column]) continue;

      const staffName = nameById.get(doc.staff_id) ?? "An employee";
      const docLabel = DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type;
      const when = daysLeft < 0 ? "has expired" : `expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;

      // Employee's own copy stays deliberately generic — no document type
      // or date, so nothing about immigration status etc. shows up on a
      // notification a screen glance could catch.
      notifications.push({
        staff_id: doc.staff_id,
        type: "document_expiring",
        message: "A document on your record needs updating soon — please speak to HR.",
      });
      for (const m of managers ?? []) {
        notifications.push({
          staff_id: m.id,
          type: "document_expiring",
          message: `${staffName}'s ${docLabel} ${when}. Check Staff Hub → HR → Documents.`,
          link: `${SITE_URL}/staff/hr`,
        });
      }
      updates.push({ id: doc.id, column: t.column });
    }
  }

  if (notifications.length > 0) {
    await supabase.from("notifications").insert(notifications);
  }
  for (const u of updates) {
    await supabase.from("employee_documents").update({ [u.column]: true }).eq("id", u.id);
  }

  return NextResponse.json({ processed: docs.length, notified: notifications.length, thresholdsCrossed: updates.length, today: todayStr });
}
