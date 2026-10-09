import type { StaffRole } from "@/lib/types";
import supabase from "@/lib/supabase";
import { ROLE_LABEL, isFrontLine } from "@/lib/roles";

// The roles shown in Settings → Roles & Permissions. Super admin is always on
// and Front House / Kitchen never have Staff Hub tabs, so they aren't editable.
export const ALL_ROLES: StaffRole[] = ["admin", "manager", "hr", "employee", "kitchen"];

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
  "approve_purchase_orders",
  "drivers",
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
  approve_purchase_orders: "Approve purchase orders",
  drivers: "Drivers",
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

// Each role gets one of three levels per area (agreed 2026-10-03):
//   off  — not in their menu; the area's APIs refuse them
//   view — they can open it and see everything, but change nothing (every
//          non-GET request is refused; the page says "View only")
//   full — see and change
export const LEVELS = ["off", "view", "full"] as const;
export type Level = (typeof LEVELS)[number];

// The agreed defaults — also the seed for role_permissions (migrations
// 102/106) and the fallback if that table can't be read. Super admin always
// has everything, Front House only the till, Kitchen nothing here. Manager:
// full on the day-to-day areas; view only on Customers & Loyalty and the
// Insights pages (Analytics, Reports, Finance); no HR & Payroll or Audit log.
// HR: Attendance & Rota, HR & Payroll and Reports.
const DEFAULTS: Record<TabKey, Partial<Record<StaffRole, Level>>> = {
  menu: { manager: "full" },
  tables: { manager: "full" },
  inventory: { manager: "full" },
  approve_stock_takes: { manager: "full" },
  // Orders over the business's limit (migration 116) — never your own.
  approve_purchase_orders: { manager: "full" },
  drivers: { manager: "full" },
  daily_accounts: { manager: "full" },
  website: { manager: "full" },
  till: { manager: "full" },
  attendance: { manager: "full", hr: "full" },
  hr: { hr: "full" },
  customers: { manager: "view" },
  analytics: { manager: "view" },
  reports: { manager: "view", hr: "full" },
  finance: { manager: "view" },
  audit: {},
  settings: { manager: "full" },
};

type Cache = Record<TabKey, Partial<Record<StaffRole, Level>>>;
let cache: Cache | null = null;
let inFlight: Promise<void> | null = null;

const asLevel = (row: { level?: string | null; granted?: boolean | null }): Level =>
  row.level === "off" || row.level === "view" || row.level === "full" ? row.level : row.granted ? "full" : "off";

async function loadCache(): Promise<void> {
  const { data, error } = await supabase.from("role_permissions").select("role, permission, granted, level");
  if (error || !data || data.length === 0) {
    cache = DEFAULTS;
    return;
  }
  const next = Object.fromEntries(TAB_KEYS.map((k) => [k, {}])) as Cache;
  for (const row of data) {
    const key = row.permission as TabKey;
    if (!(TAB_KEYS as readonly string[]).includes(key)) continue;
    next[key][row.role as StaffRole] = asLevel(row);
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

/** This role's level for an area. Super admin: always full. Front House: the
 *  till only. Kitchen (and old driver accounts): nothing here. */
let loadedAt = Date.now(); // the import above already loaded it
function keepFresh() {
  if (!inFlight && Date.now() - loadedAt > 60_000) {
    loadedAt = Date.now();
    refreshPermissionsCache().catch(() => {});
  }
}

export function levelOf(role: StaffRole, tab: TabKey): Level {
  keepFresh();
  // transition safety net: pre-migration-032 accounts may still be "owner"
  if (role === "admin" || (role as string) === "owner") return "full";
  if (role === "employee") return tab === "till" ? "full" : "off";
  if (isFrontLine(role)) return "off";
  return (cache ?? DEFAULTS)[tab]?.[role] ?? "off";
}

/** Can open the area (view or full). */
export function canAccess(role: StaffRole, tab: TabKey): boolean {
  return levelOf(role, tab) !== "off";
}

/** Can change things in the area (full only). */
export function canEdit(role: StaffRole, tab: TabKey): boolean {
  return levelOf(role, tab) === "full";
}

/** For an API route: reading (GET/HEAD) needs view or full, anything that
 *  changes data needs full. */
export function areaAllows(role: StaffRole, tab: TabKey, method: string): boolean {
  return method === "GET" || method === "HEAD" ? canAccess(role, tab) : canEdit(role, tab);
}

/** For an area whose data other screens also read (the till's tables, the
 *  menu, business settings): any management role can read it, but changing
 *  it needs full on that area. */
export function manageAllows(role: StaffRole, tab: TabKey, method: string): boolean {
  return method === "GET" || method === "HEAD" ? isStaffManagement(role) : canEdit(role, tab);
}

/** Management-level at all (Staff Hub layout gate). Excludes the front-line
 *  roles under both the new (employee) and pre-migration-032 role names. */
export function isStaffManagement(role: StaffRole): boolean {
  return !["employee", "cashier", "waiter", "chef", "kitchen", "driver"].includes(role as string);
}

// --- shims used by API routes / pages --------------------------------------
export const canManageStaff = (role: StaffRole) => isStaffManagement(role);
export const canManageInventory = (role: StaffRole) => canAccess(role, "inventory");
export const canManageFinance = (role: StaffRole) => canAccess(role, "finance");
export const canApproveStockTakes = (role: StaffRole) => canEdit(role, "approve_stock_takes");
export const canApprovePurchaseOrders = (role: StaffRole) => canEdit(role, "approve_purchase_orders");
export const canViewCrm = (role: StaffRole) => canAccess(role, "customers");
export const canManageCrm = (role: StaffRole) => canEdit(role, "customers");
export const canManageDrivers = (role: StaffRole) => canAccess(role, "drivers");
export const canManageDailyAccounts = (role: StaffRole) => canAccess(role, "daily_accounts");
/** Taking orders and payments on the till (full only). */
export const canUseTill = (role: StaffRole) => canEdit(role, "till");

// --- Settings → Roles & Permissions editor --------------------------------
export async function getPermissionMatrix(): Promise<Record<TabKey, Record<StaffRole, Level>>> {
  const { data } = await supabase.from("role_permissions").select("role, permission, granted, level");
  const matrix = Object.fromEntries(
    TAB_KEYS.map((k) => [k, Object.fromEntries(ALL_ROLES.map((r) => [r, DEFAULTS[k][r] ?? "off"]))]),
  ) as Record<TabKey, Record<StaffRole, Level>>;
  for (const row of data ?? []) {
    const key = row.permission as TabKey;
    if ((TAB_KEYS as readonly string[]).includes(key) && ALL_ROLES.includes(row.role as StaffRole)) {
      matrix[key][row.role as StaffRole] = asLevel(row);
    }
  }
  // Super admin is always full, Front House only the till, Kitchen always off —
  // not editable.
  for (const k of TAB_KEYS) {
    matrix[k].admin = "full";
    matrix[k].employee = k === "till" ? "full" : "off";
    matrix[k].kitchen = "off";
  }
  return matrix;
}
