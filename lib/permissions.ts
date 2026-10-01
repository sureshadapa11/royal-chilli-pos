import type { StaffRole } from "@/lib/types";
import supabase from "@/lib/supabase";

export const ALL_ROLES: StaffRole[] = ["employee", "manager", "hr", "admin"];

export const ROLE_LABELS: Record<StaffRole, string> = {
  employee: "Employee",
  manager: "Manager",
  hr: "HR",
  admin: "Admin",
};

// One permission per Staff Hub tab (tab-level access, per the owner's decision —
// no finer-grained switches). `role_permissions.permission` holds these keys.
export const TAB_KEYS = [
  "attendance",
  "hr",
  "menu",
  "tables",
  "inventory",
  "finance",
  "analytics",
  "reports",
  "audit",
  "settings",
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABELS: Record<TabKey, string> = {
  attendance: "Attendance & Rota",
  hr: "HR Management (incl. Payroll)",
  menu: "Menu Management",
  tables: "Tables",
  inventory: "Inventory",
  finance: "Finance",
  analytics: "Analytics",
  reports: "Reports",
  audit: "Audit Log",
  settings: "Settings",
};

// The agreed default matrix — also the seed for role_permissions and the
// fail-closed fallback if that table can't be read. admin always has every tab;
// employee never has Staff Hub.
const DEFAULTS: Record<TabKey, StaffRole[]> = {
  attendance: ["manager", "hr", "admin"],
  hr: ["hr", "admin"],
  menu: ["manager", "admin"],
  tables: ["manager", "admin"],
  inventory: ["manager", "admin"],
  finance: ["manager", "hr", "admin"],
  analytics: ["manager", "admin"],
  reports: ["manager", "hr", "admin"],
  audit: ["admin"],
  settings: ["admin"],
};

function defaultsAsSets(): Record<TabKey, Set<StaffRole>> {
  return Object.fromEntries(TAB_KEYS.map((k) => [k, new Set(DEFAULTS[k])])) as Record<
    TabKey,
    Set<StaffRole>
  >;
}

let cache: Record<TabKey, Set<StaffRole>> | null = null;
let inFlight: Promise<void> | null = null;

async function loadCache(): Promise<void> {
  const { data, error } = await supabase.from("role_permissions").select("role, permission, granted");
  if (error || !data || data.length === 0) {
    cache = defaultsAsSets();
    return;
  }
  const next = Object.fromEntries(TAB_KEYS.map((k) => [k, new Set<StaffRole>()])) as Record<
    TabKey,
    Set<StaffRole>
  >;
  for (const row of data) {
    const key = row.permission as TabKey;
    if (row.granted && (TAB_KEYS as readonly string[]).includes(key)) {
      next[key].add(row.role as StaffRole);
    }
  }
  cache = next;
}

export function refreshPermissionsCache(): Promise<void> {
  inFlight = loadCache().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

refreshPermissionsCache();

// ---------------------------------------------------------------------------

/** Can this role open the given Staff Hub tab? admin: always. employee: never. */
export function canAccess(role: StaffRole, tab: TabKey): boolean {
  // transition safety net: pre-migration-032 accounts may still be "owner"
  if (role === "admin" || (role as string) === "owner") return true;
  if (role === "employee") return false;
  const set = cache?.[tab];
  return set ? set.has(role) : DEFAULTS[tab].includes(role);
}

/** Management-level at all (Staff Hub layout gate). Excludes the front-line
 *  roles under both the new (employee) and pre-migration-032 role names. */
export function isStaffManagement(role: StaffRole): boolean {
  return !["employee", "cashier", "waiter", "chef", "kitchen", "driver"].includes(role as string);
}

// --- back-compat shims: existing API routes still import these -------------
// They now mean "some management role", tightened per-tab at the page level.
// A follow-up will point the API routes at canAccess() directly.
export const canManageStaff = (role: StaffRole) => isStaffManagement(role);
export const canManageInventory = (role: StaffRole) => canAccess(role, "inventory");
export const canManageFinance = (role: StaffRole) => canAccess(role, "finance");
export const canApproveStockTakes = (role: StaffRole) => canAccess(role, "inventory");
// Drivers (roster + assigning deliveries) and Customers & Loyalty share this
// admin/manager gate; both are linked from the Staff Hub sidebar.
export const canViewCrm = (role: StaffRole) => role === "admin" || role === "manager";
export const canManageCrm = (role: StaffRole) => role === "admin" || role === "manager";
export const canManageDrivers = (role: StaffRole) => role === "admin" || role === "manager";

// --- Settings → Roles & Permissions editor --------------------------------
export async function getPermissionMatrix(): Promise<Record<TabKey, Record<StaffRole, boolean>>> {
  const { data } = await supabase.from("role_permissions").select("role, permission, granted");
  const matrix = Object.fromEntries(
    TAB_KEYS.map((k) => [k, Object.fromEntries(ALL_ROLES.map((r) => [r, DEFAULTS[k].includes(r)]))]),
  ) as Record<TabKey, Record<StaffRole, boolean>>;
  for (const row of data ?? []) {
    const key = row.permission as TabKey;
    if ((TAB_KEYS as readonly string[]).includes(key) && ALL_ROLES.includes(row.role as StaffRole)) {
      matrix[key][row.role as StaffRole] = !!row.granted;
    }
  }
  // admin is always on, employee always off — not editable.
  for (const k of TAB_KEYS) {
    matrix[k].admin = true;
    matrix[k].employee = false;
  }
  return matrix;
}
