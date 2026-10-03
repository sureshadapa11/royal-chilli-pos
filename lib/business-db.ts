import supabase from "@/lib/supabase";

// Tables whose rows belong to one business (migrations 076, 078, 079). Staff
// also belong to one business (staff.business_id) but are looked up by id and
// username across the group, so they're filtered explicitly (staffIdsAt /
// staffWorksAt) rather than here. HR records, addresses and points history
// follow their staff member / customer.
export const BUSINESS_TABLES = new Set([
  "business_private", "business_settings", "pos_devices", "locations",
  "menu_categories", "menu_items", "modifier_groups", "featured_dishes", "promotions",
  "restaurant_tables", "table_requests", "reservations", "delivery_zones",
  "work_periods", "orders", "payments", "print_jobs",
  "ingredients", "recipes", "stock_movements", "stock_takes", "purchase_orders",
  "supplier_payments", "expenses",
  "fs_check_type", "fs_check_log", "fs_temp_type", "fs_temp_log",
  "fs_delivery_check", "fs_problem", "fs_signoff",
  "shifts", "attendance", "timesheets", "payroll_periods", "employee_payslips", "leave_requests",
  "audit_logs", "loyalty_transactions", "platform_sales", "staff_messages", "attendance_corrections",
  // 098: day-end accounts sheet
  "daily_accounts",
  // 079: every business independent
  "suppliers", "customers", "loyalty_tiers", "loyalty_rewards", "loyalty_redemptions", "newsletter_subscribers",
  // 080/084: per-business setup and directly scopeable children.
  "cash_paid_outs", "customer_addresses", "loyalty_tier_changes",
  "menu_item_modifier_groups", "modifier_options", "order_items", "order_item_modifiers",
  "payroll_entries", "payroll_payments", "purchase_order_items", "recipe_ingredients", "stock_take_lines",
]);

type Builder = ReturnType<typeof supabase.from>;
type Row = Record<string, unknown>;

/**
 * The database as one business sees it. Use in place of `supabase` in server
 * code: `bizDb(session.businessId).from("orders").select(...)`.
 *
 * For a business table, every select / update / delete is limited to that
 * business's rows, and every insert / upsert is written as that business
 * (any business_id passed in is overwritten, and an update can't move a row
 * to another business). Shared tables pass straight through.
 *
 * Child rows (payments, stock movements, …) also take their parent's business
 * in the database itself, and an order can't use another business's table —
 * see the triggers in migration 076.
 */
export function bizDb(businessId: number) {
  if (!Number.isInteger(businessId) || businessId < 1) throw new Error(`bizDb: bad business id ${businessId}`);

  const stamp = (v: Row | Row[]) => (Array.isArray(v) ? v.map((r) => ({ ...r, business_id: businessId })) : { ...v, business_id: businessId });
  const unstamp = (v: Row) => {
    const { business_id: _ignored, ...rest } = v;
    void _ignored;
    return rest;
  };

  return {
    businessId,
    from(table: string): Builder {
      const q = supabase.from(table);
      if (!BUSINESS_TABLES.has(table)) return q;
      const scoped = {
        select: (...a: Parameters<Builder["select"]>) => q.select(...a).eq("business_id", businessId),
        insert: (v: Row | Row[], o?: Parameters<Builder["insert"]>[1]) => q.insert(stamp(v), o),
        upsert: (v: Row | Row[], o?: Parameters<Builder["upsert"]>[1]) => q.upsert(stamp(v), o),
        update: (v: Row, o?: Parameters<Builder["update"]>[1]) => q.update(unstamp(v), o).eq("business_id", businessId),
        delete: (o?: Parameters<Builder["delete"]>[0]) => q.delete(o).eq("business_id", businessId),
      };
      return scoped as unknown as Builder;
    },
  };
}

export type BizDb = ReturnType<typeof bizDb>;

/**
 * True when every id is a row of `table` belonging to this business — check
 * this before linking to a parent row (a category, a menu item, a modifier
 * group) so nothing can be attached to another business's data.
 */
export async function allOwned(db: BizDb, table: string, ids: (number | string)[]): Promise<boolean> {
  const unique = [...new Set(ids.map(Number))];
  if (unique.length === 0) return true;
  if (unique.some((id) => !Number.isInteger(id) || id <= 0)) return false;
  const { data, error } = await db.from(table).select("id").in("id", unique);
  if (error) throw error;
  return (data ?? []).length === unique.length;
}

/** A payroll entry is this business's when its pay period is (entries have no business of their own). */
export async function payrollEntryOwned(db: BizDb, entryId: number | string): Promise<boolean> {
  const { data, error } = await supabase
    .from("payroll_entries")
    .select("id, payroll_periods!inner(business_id)")
    .eq("id", entryId)
    .eq("payroll_periods.business_id", db.businessId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Is this one of the business's own staff? (The owner isn't anyone's staff.) */
export async function staffWorksAt(db: BizDb, staffId: number | string): Promise<boolean> {
  const { data, error } = await supabase
    .from("staff").select("id")
    .eq("id", Number(staffId)).eq("business_id", db.businessId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}
