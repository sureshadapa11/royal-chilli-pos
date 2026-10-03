// The six roles (agreed 2026-10-03). Internal keys stay as they were in the
// database; only the names people see changed:
//   admin      → Super admin — exactly one in the whole system (the group
//                owner); never assignable to anyone else
//   supervisor → Supervisor  — above Manager; Super admin ticks extra access
//   manager    → Manager
//   hr         → HR
//   employee   → Front House — the till only (PIN on a paired till)
//   kitchen    → Kitchen     — the Kitchen Display only (PIN on a paired screen)
// "driver" is retired (no one can be given it) but old accounts still work.
// Safe to import in the browser.

export const ROLE_LABEL: Record<string, string> = {
  admin: "Super admin",
  supervisor: "Supervisor",
  manager: "Manager",
  hr: "HR",
  employee: "Front House",
  kitchen: "Kitchen",
  driver: "Driver",
};

export const roleLabel = (role: string | null | undefined) => (role ? ROLE_LABEL[role] ?? role : "");

/** Roles HR / managers can give someone — Super admin is never one of them. */
export const ASSIGNABLE_ROLES = [
  { value: "supervisor", label: "Supervisor — above Manager; extra access set by Super admin" },
  { value: "manager", label: "Manager — runs the restaurant day to day" },
  { value: "hr", label: "HR — people, payroll and attendance" },
  { value: "employee", label: "Front House — the till only" },
  { value: "kitchen", label: "Kitchen — the Kitchen Display only" },
] as const;

export const ASSIGNABLE_ROLE_KEYS: string[] = ASSIGNABLE_ROLES.map((r) => r.value);

/** Manager level and up: approve refunds, pair tills, see management alerts. */
export const MANAGER_ROLES = ["admin", "supervisor", "manager"] as const;
export const isManagerRole = (role: string) => (MANAGER_ROLES as readonly string[]).includes(role);

/** Front-line roles: PIN on a paired device only — no password sign-in, no Staff Hub. */
export const FRONT_LINE_ROLES = ["employee", "kitchen", "driver"] as const;
export const isFrontLine = (role: string) => (FRONT_LINE_ROLES as readonly string[]).includes(role);

/**
 * Can someone with `actor` role give a staff member `target` role? Super
 * admin is never given. Super admin, Supervisor and HR can give any of the
 * five; a Manager can only add Front House and Kitchen staff (so they can't
 * create an account with more access than their own).
 */
export function canGiveRole(actor: string, target: string): boolean {
  if (!ASSIGNABLE_ROLE_KEYS.includes(target)) return false;
  if (actor === "admin" || actor === "supervisor" || actor === "hr") return true;
  if (actor === "manager") return target === "employee" || target === "kitchen";
  return false;
}

/** Can `actor` change role, active status or password of other staff? */
export const canChangeAccess = (actor: string) => actor === "admin" || actor === "supervisor" || actor === "hr";
