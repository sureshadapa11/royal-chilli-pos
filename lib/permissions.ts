import type { StaffRole } from "@/lib/types";
import supabase from "@/lib/supabase";
import { ROLE_LABEL, isFrontLine } from "@/lib/roles";

// The roles shown in Settings → Roles & Permissions. Super admin is always on
// and Front House / Kitchen never have Staff Hub tabs, so they aren't editable.
export const ALL_ROLES: StaffRole[] = ["admin", "supervisor", "manager", "hr", "employee", "kitchen"];

export const ROLE_LABELS = Object.fromEntries(ALL_ROLES.map((r) => [r, ROLE_LABEL[r]])) as Record<StaffRole, string>;

// One tick per Staff Hub area (Settings → Roles & Permissions, agreed
// 2026-10-03), plus approve_stock_takes: posting a counted stock take is a
// separate sign-off from counting it (Inventory). `role_permissions.permission`
// holds these keys; the order here is the order on screen.
export const TAB_KEYS = [
  "menu",
  "tables",
  "inventory",
  "approve_stock_takes",
  "drivers",
  "delivery_platforms",
  "daily_accounts",
  "website",
  "till",
  "attendance",
  "hr",
  "customers",
  "analytics",
  "reports",
  "finance",
  "audit",
  "settings",
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABELS: Record<TabKey, string> = {
  menu: "Menu",
  tables: "Tables",
  inventory: "Inventory",
  approve_stock_takes: "Approve stock takes",
  drivers: "Drivers",
  delivery_platforms: "Delivery platforms",
  daily_accounts: "Daily accounts",
  website: "Website",
  till: "Till",
  attendance: "Attendance & Rota",
  hr: "HR & Payroll",
  customers: "Customers & Loyalty",
  analytics: "Analytics",
  reports: "Reports",
  finance: "Finance",
  audit: "Audit log",
  settings: "Settings",
};

// The agreed defaults — also the seed for role_permissions (migration 102) and
// the fail-closed fallback if that table can't be read. Super admin always has
// everything; Front House only the till; Kitchen nothing here. Manager (and
// Supervisor, until Super admin ticks more): operations, attendance, customers
// and settings — no HR & Payroll, no Insights (analytics, reports, finance,
// audit log). HR: attendance, HR & Payroll and reports.
const MGR: StaffRole[] = ["supervisor", "manager", "admin"];
const DEFAULTS: Record<TabKey, StaffRole[]> = {
  menu: MGR,
  tables: MGR,
  inventory: MGR,
  approve_stock_takes: MGR,
  drivers: MGR,
  delivery_platforms: MGR,
  daily_accounts: MGR,
  website: MGR,
  till: MGR,
  attendance: ["supervisor", "manager", "hr", "admin"],
  hr: ["hr", "admin"],
  customers: MGR,
  analytics: ["admin"],
  reports: ["hr", "admin"],
  finance: ["admin"],
  audit: ["admin"],
  settings: MGR,
};

const ADDED_IN_102: TabKey[] = ["drivers", "delivery_platforms", "daily_accounts", "till", "customers"];

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
  const stored = new Set<string>();
  for (const row of data) {
    const key = row.permission as TabKey;
    if (!(TAB_KEYS as readonly string[]).includes(key)) continue;
    stored.add(key);
    if (row.granted) next[key].add(row.role as StaffRole);
  }
  // Areas added with migration 102: until it has run, use the agreed defaults
  // rather than locking everyone out of the till, drivers, customers, etc.
  for (const k of ADDED_IN_102) if (!stored.has(k)) next[k] = new Set(DEFAULTS[k]);
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

/** Can this role use the given area? Super admin: always. Front House: the
 *  till only. Kitchen (and old driver accounts): nothing here. */
export function canAccess(role: StaffRole, tab: TabKey): boolean {
  // transition safety net: pre-migration-032 accounts may still be "owner"
  if (role === "admin" || (role as string) === "owner") return true;
  if (role === "employee") return tab === "till";
  if (isFrontLine(role)) return false;
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
export const canApproveStockTakes = (role: StaffRole) => canAccess(role, "approve_stock_takes");
export const canViewCrm = (role: StaffRole) => canAccess(role, "customers");
export const canManageCrm = (role: StaffRole) => canAccess(role, "customers");
export const canManageDrivers = (role: StaffRole) => canAccess(role, "drivers");
export const canManageDailyAccounts = (role: StaffRole) => canAccess(role, "daily_accounts");
export const canManagePlatformSales = (role: StaffRole) => canAccess(role, "delivery_platforms");
/** Taking orders and payments on the till. */
export const canUseTill = (role: StaffRole) => canAccess(role, "till");

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
  // Super admin is always on, Front House only the till, Kitchen always off —
  // not editable.
  for (const k of TAB_KEYS) {
    matrix[k].admin = true;
    matrix[k].employee = k === "till";
    matrix[k].kitchen = false;
  }
  return matrix;
}
