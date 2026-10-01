import fs from "fs";
import path from "path";

describe("migration 085 — remove global uniques for multi-business", () => {
  const migrationPath = path.resolve(
    process.cwd(),
    "supabase/migrations/085_remove_global_uniques_for_multi_business.sql"
  );
  let sql: string;

  beforeAll(() => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    sql = fs.readFileSync(migrationPath, "utf8");
  });

  it("is transactional and safely repeatable", () => {
    expect(sql).toMatch(/^\s*--[^\n]*\n[\s\S]*\bBEGIN\s*;/m);
    expect(sql).toMatch(/\bCOMMIT\s*;/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS customers_business_email_account_unique/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS/);
    expect(sql).toMatch(/DROP INDEX IF EXISTS/);
  });

  it("validates prerequisite tables and business_id columns before making changes", () => {
    expect(sql).toContain("customers");
    expect(sql).toContain("newsletter_subscribers");
    expect(sql).toContain("loyalty_tiers");
    expect(sql).toContain("timesheets");
    expect(sql).toMatch(/Migration 085 requires business_id on customers/);
  });

  it("ensures all 5 required business-scoped unique rules exist", () => {
    expect(sql).toContain("customers_business_phone_unique");
    expect(sql).toMatch(/UNIQUE\s*\(\s*business_id\s*,\s*phone\s*\)/i);

    expect(sql).toContain("customers_business_email_account_unique");
    expect(sql).toMatch(/ON\s+customers\s*\(\s*business_id\s*,\s*lower\(email\)\s*\)\s*WHERE\s+password_hash\s+IS\s+NOT\s+NULL/i);

    expect(sql).toContain("newsletter_business_email_unique");
    expect(sql).toMatch(/UNIQUE\s*\(\s*business_id\s*,\s*email\s*\)/i);

    expect(sql).toContain("loyalty_tiers_business_name_unique");
    expect(sql).toMatch(/UNIQUE\s*\(\s*business_id\s*,\s*name\s*\)/i);

    expect(sql).toContain("timesheets_business_unique");
    expect(sql).toMatch(/UNIQUE\s*\(\s*business_id\s*,\s*staff_id\s*,\s*period_start\s*,\s*period_end\s*\)/i);
  });

  it("removes only the 5 obsolete global uniqueness rules", () => {
    expect(sql).toContain("customers_phone_key");
    expect(sql).toContain("customers_email_account_unique");
    expect(sql).toContain("newsletter_subscribers_email_key");
    expect(sql).toContain("loyalty_tiers_name_key");
    expect(sql).toContain("timesheets_staff_id_period_start_period_end_key");

    // Catalog check loops for constraints and standalone indexes
    expect(sql).toMatch(/pg_constraint/);
    expect(sql).toMatch(/pg_index/);
  });

  it("explicitly preserves intentional global uniqueness rules and does not delete user data", () => {
    // Preserves intentional global uniqueness
    expect(sql).toContain("staff_username_key");
    expect(sql).toContain("staff_employee_number_key");
    expect(sql).toContain("customers_referral_code_key");
    expect(sql).toContain("loyalty_redemptions_code_key");

    // Must not touch or drop global staff usernames or codes
    expect(sql).not.toMatch(/DROP\s+CONSTRAINT[^\n;]*staff_username_key/i);
    expect(sql).not.toMatch(/DROP\s+CONSTRAINT[^\n;]*staff_employee_number_key/i);
    expect(sql).not.toMatch(/DROP\s+CONSTRAINT[^\n;]*customers_referral_code_key/i);
    expect(sql).not.toMatch(/DROP\s+CONSTRAINT[^\n;]*loyalty_redemptions_code_key/i);

    // Must not silently delete, truncate, or rewrite data
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });

  it("includes verification queries for post-application inspection in Supabase", () => {
    expect(sql).toContain("Verification queries");
    expect(sql).toMatch(/SELECT[\s\S]*?conname[\s\S]*?FROM\s+pg_constraint/i);
    expect(sql).toMatch(/SELECT[\s\S]*?indexname[\s\S]*?FROM\s+pg_indexes/i);
  });
});
