// Logical backup of the Postgres database: dumps every application table's
// rows to JSON (one file per table) plus a copy of the current schema.sql,
// into a timestamped folder. Restorable with scripts/restore.js.
//
// Why JSON-per-table instead of pg_dump: pg_dump requires the Postgres client
// tools to be installed on whatever machine runs this, which isn't guaranteed
// (e.g. a Vercel cron function, a bare Windows machine). This only needs the
// `pg` npm package, which is already a project dependency, so it runs anywhere
// Node runs. See docs/BACKUP.md for the full backup strategy (this script is
// the "portable, owner-controlled" layer, not the only line of defense).
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

// Same order tables are CREATEd in supabase/schema.sql and migrations — parents
// before children, so a restore can INSERT in this order without FK violations.
const TABLES = [
  "businesses",
  "business_settings",
  "staff",
  "business_private",
  "staff_businesses",
  "staff_hr_details",
  "staff_onboarding_tasks",
  "staff_references",
  "staff_rtw_verification",
  "employee_documents",
  "employee_payslips",
  "staff_availability",
  "staff_messages",
  "push_subscriptions",
  "notification_prefs",
  "notifications",
  "shift_alerts_sent",
  "customers",
  "customer_addresses",
  "newsletter_subscribers",
  "loyalty_tiers",
  "loyalty_rewards",
  "loyalty_transactions",
  "loyalty_redemptions",
  "loyalty_tier_changes",
  "menu_categories",
  "modifier_groups",
  "modifier_options",
  "menu_items",
  "menu_item_modifier_groups",
  "featured_dishes",
  "promotions",
  "restaurant_tables",
  "work_periods",
  "delivery_zones",
  "orders",
  "order_items",
  "order_item_modifiers",
  "payments",
  "print_jobs",
  "reservations",
  "table_requests",
  "shifts",
  "breaks",
  "clock_events",
  "timesheets",
  "leave_requests",
  "payroll_periods",
  "payroll_entries",
  "payroll_payments",
  "audit_logs",
  "app_settings",
  "role_permissions",
  "suppliers",
  "ingredients",
  "purchase_orders",
  "purchase_order_items",
  "stock_movements",
  "stock_takes",
  "stock_take_lines",
  "recipes",
  "recipe_ingredients",
  "expenses",
  "supplier_payments",
  "cash_paid_outs",
  "platform_sales",
  "fs_check_type",
  "fs_check_log",
  "fs_course",
  "fs_delivery_check",
  "fs_problem",
  "fs_signoff",
  "fs_temp_type",
  "fs_temp_log",
  "fs_training_record",
];

// Sensitive columns that must be redacted in backups to protect private payment credentials
const REDACTED_COLUMNS = {
  business_private: [
    "stripe_secret_key_enc",
    "stripe_webhook_secret_enc",
    "sumup_api_key_enc",
  ],
};

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set. Add it to .env.local or export it before running this script.");
    process.exit(1);
  }

  const outDir = process.argv[2] || path.join(__dirname, "..", "backups", new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(outDir, { recursive: true });

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const manifest = { createdAt: new Date().toISOString(), tables: {} };

  try {
    const { rows: tableRows } = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
    );
    const existingTables = new Set(tableRows.map((r) => r.table_name));

    for (const table of TABLES) {
      if (!existingTables.has(table)) {
        console.log(`  ${table}: table does not exist in target database, skipping`);
        continue;
      }

      const { rows } = await client.query(`SELECT * FROM ${table}`);
      const redactedFields = REDACTED_COLUMNS[table];
      const safeRows = redactedFields
        ? rows.map((r) => {
            const copy = { ...r };
            for (const field of redactedFields) {
              if (copy[field] != null) {
                copy[field] = "[REDACTED]";
              }
            }
            return copy;
          })
        : rows;

      fs.writeFileSync(path.join(outDir, `${table}.json`), JSON.stringify(safeRows, null, 2));
      manifest.tables[table] = safeRows.length;
      console.log(`  ${table}: ${safeRows.length} rows`);
    }
  } finally {
    await client.end();
  }

  const schemaSrc = path.join(__dirname, "..", "supabase", "schema.sql");
  if (fs.existsSync(schemaSrc)) {
    fs.copyFileSync(schemaSrc, path.join(outDir, "schema.sql"));
  }

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const totalRows = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
  console.log(`\nBackup complete: ${outDir}`);
  console.log(`${TABLES.length} tables, ${totalRows} total rows.`);
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
