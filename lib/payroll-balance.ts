// Safe in the browser (HR → Payslips shows it before saving).

/**
 * What a payslip still owes (pure): pay − wages already paid in cash that
 * period − the advance taken off (never more than what's left to pay).
 */
export function balanceToPay(total: number, cashPaid: number, advanceOutstanding: number, deductAdvance: boolean) {
  const r = (n: number) => Math.round(n * 100) / 100;
  const afterCash = Math.max(0, r(total - cashPaid));
  const advanceDeducted = deductAdvance ? Math.min(Math.max(0, r(advanceOutstanding)), afterCash) : 0;
  return { advance_deducted: advanceDeducted, balance: r(afterCash - advanceDeducted) };
}
