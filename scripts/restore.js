// Restores a backup produced by scripts/backup.js. DESTRUCTIVE: replaces the
// contents of every table it has a JSON file for. Intended for disaster
// recovery onto a fresh database (after running supabase/schema.sql there) or
// for restoring a demo/staging environment — not for casual use against a
// live production database.
//
// Usage: node scripts/restore.js <backup-folder> --force
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

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

async function main() {
  const backupDir = process.argv[2];
  const force = process.argv.includes("--force");

  if (!backupDir || !fs.existsSync(backupDir)) {
    console.error("Usage: node scripts/restore.js <backup-folder> --force");
    process.exit(1);
  }
  if (!force) {
    console.error(
      "This will DELETE and REPLACE every row in every table listed below, in the target database.\n" +
      "Re-run with --force once you're certain that's what you want, and that DATABASE_URL points at the right database."
    );
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const { rows: tableRows } = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
    );
    const existingTables = new Set(tableRows.map((r) => r.table_name));

    await client.query("BEGIN");

    // Delete children before parents, insert parents before children.
    for (const table of [...TABLES].reverse()) {
      if (!existingTables.has(table)) continue;
      await client.query(`DELETE FROM ${table}`);
    }

    for (const table of TABLES) {
      if (!existingTables.has(table)) {
        console.log(`  ${table}: table does not exist in target database, skipping`);
        continue;
      }

      const file = path.join(backupDir, `${table}.json`);
      if (!fs.existsSync(file)) {
        console.log(`  ${table}: no backup file, skipping`);
        continue;
      }
      const rows = JSON.parse(fs.readFileSync(file, "utf8"));
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]);
      const colList = columns.map((c) => `"${c}"`).join(", ");
      for (const row of rows) {
        const values = columns.map((c) => (row[c] === "[REDACTED]" ? null : row[c]));
        const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
        await client.query(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})`, values);
      }
      console.log(`  ${table}: restored ${rows.length} rows`);

      // Restored rows carry their original explicit ids, so the table's
      // auto-increment sequence needs bumping past the highest one restored
      // or the next app-side insert would collide with a restored row.
      if (columns.includes("id")) {
        try {
          await client.query(
            `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`,
            [table]
          );
        } catch {
          // Table may not use a serial sequence on id; ignore.
        }
      }
    }

    await client.query("COMMIT");
    console.log("\nRestore complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Restore failed, rolled back:", err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
