import type { StaffRole } from "@/lib/types";
import { canEdit as canEditArea, canAccess } from "@/lib/permissions";

// Who sees what in Staff Hub → Daily accounts (agreed 2026-10-12):
//   Super admin (group owner) — every tab; enter, correct a submitted day, delete
//   Supervisor               — every tab, view only (no entering, correcting or deleting)
//   HR                       — the Salary tab only
//   Manager (and anyone else with the Daily accounts area) — the Day tab and
//                              Catering & events and Pending bills (add, record payments),
//                              to enter or complete a day; no figures (cash
//                              check, WhatsApp, cash book, Excel)
//   Manager only (2026-10-19)  — also the Month sheet, on screen only (no
//                              Excel download, no print)
// Staff enter through the staff links (Day End, Money In / Out) as before.

export type AccountsTab = "day" | "month" | "cash" | "book" | "salary" | "jobs" | "bills";
export type AccountsAccess = {
  tabs: AccountsTab[];
  canEnter: boolean;     // type into a day and submit it
  canCorrect: boolean;   // change a day that's already submitted
  canDelete: boolean;    // delete a Money In / Out entry
  seeFigures: boolean;   // month, cash book, money in/out list, cash check, WhatsApp, Excel
  canExport: boolean;    // Month sheet's Excel download and Print / PDF
};

const ALL: AccountsTab[] = ["day", "month", "jobs", "bills", "cash", "book", "salary"];

export function accountsAccess(s: { role: string; owner?: boolean }): AccountsAccess {
  if (s.owner || s.role === "admin") return { tabs: ALL, canEnter: true, canCorrect: true, canDelete: true, seeFigures: true, canExport: true };
  if (s.role === "supervisor") return { tabs: ALL, canEnter: false, canCorrect: false, canDelete: false, seeFigures: true, canExport: true };
  if (s.role === "hr") return { tabs: ["salary"], canEnter: false, canCorrect: false, canDelete: false, seeFigures: false, canExport: false };
  const role = s.role as StaffRole;
  if (canAccess(role, "daily_accounts")) {
    return {
      tabs: role === "manager" ? ["day", "month", "jobs", "bills"] : ["day", "jobs", "bills"],
      canEnter: canEditArea(role, "daily_accounts"), canCorrect: false, canDelete: false, seeFigures: false, canExport: false,
    };
  }
  return { tabs: [], canEnter: false, canCorrect: false, canDelete: false, seeFigures: false, canExport: false };
}
