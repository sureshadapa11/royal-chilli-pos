import type { bizDb } from "@/lib/business-db";

/**
 * The float the last counted day before `date` left in the till: its count −
 * the cash taken to the Safe (136). It's the next day's opening, and the float
 * the Day End offers to leave again (agreed 2026-10-16). Null when no day before
 * was counted.
 */
export async function lastFloat(db: ReturnType<typeof bizDb>, date: string): Promise<{ date: string; amount: number } | null> {
  const { data } = await db.from("daily_accounts").select("trading_date, closing_balance, bank_in")
    .lt("trading_date", date).not("closing_balance", "is", null).order("trading_date", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  return { date: data.trading_date as string, amount: Math.round((Number(data.closing_balance) - Number(data.bank_in ?? 0)) * 100) / 100 };
}
