import type { BizDb } from "@/lib/business-db";
import { allRows, chunked } from "@/lib/finance";
import { londonDateStr, londonDayRangeUtc } from "@/lib/london-date";
import type { ReceiptEntity } from "@/lib/receipts";

// Everything paid out in a month — expenses, supplier payments and stock
// deliveries received — with the receipt photos behind each. The accountant
// export lists it ("Money out" sheet) and the receipts zip uses the same file
// names, so each row points at its photos in the zip.

export type MoneyOutRow = {
  entity: ReceiptEntity;
  entityId: number;
  date: string;
  type: string;
  paidTo: string;
  details: string;
  amount: number;
  photos: { id: number; filePath: string; fileName: string; aiTotal: number | null; mismatch: boolean; aiStatus: string }[];
};

const TYPE_LABEL: Record<ReceiptEntity, string> = { expense: "Expense", supplier_payment: "Supplier payment", purchase_order: "Stock delivery" };
const SHORT: Record<ReceiptEntity, string> = { expense: "expense", supplier_payment: "supplier-payment", purchase_order: "delivery" };

export async function moneyOutForMonth(db: BizDb, month: string): Promise<MoneyOutRow[]> {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(lastDay).padStart(2, "0")}`;
  const start = londonDayRangeUtc(from).start;
  const end = londonDayRangeUtc(to).end;

  type Exp = { id: number; category: string; description: string; amount: number; expense_date: string };
  type Pay = { id: number; amount: number; method: string | null; paid_at: string; supplier: unknown };
  type Po = { id: number; order_number: string; total_cost: number; received_date: string; supplier: unknown };
  const nameOf = (s: unknown) => (s as { name: string } | null)?.name ?? "";
  const [expenses, payments, pos] = await Promise.all([
    allRows<Exp>((a, b) => db.from("expenses").select("id, category, description, amount, expense_date")
      .gte("expense_date", from).lte("expense_date", to).order("expense_date").order("id").range(a, b)),
    allRows<Pay>((a, b) => db.from("supplier_payments").select("id, amount, method, paid_at, supplier:suppliers(name)")
      .gte("paid_at", start).lte("paid_at", end).order("paid_at").order("id").range(a, b)),
    allRows<Po>((a, b) => db.from("purchase_orders").select("id, order_number, total_cost, received_date, supplier:suppliers(name)")
      .eq("status", "received").gte("received_date", from).lte("received_date", to).order("received_date").order("id").range(a, b)),
  ]);

  const rows: MoneyOutRow[] = [
    ...expenses.map((e) => ({
      entity: "expense" as const, entityId: e.id, date: e.expense_date, type: TYPE_LABEL.expense,
      paidTo: "", details: `${e.category.replace(/_/g, " ")} · ${e.description}`, amount: Number(e.amount), photos: [],
    })),
    ...payments.map((p) => ({
      entity: "supplier_payment" as const, entityId: p.id, date: londonDateStr(new Date(p.paid_at)), type: TYPE_LABEL.supplier_payment,
      paidTo: nameOf(p.supplier), details: p.method ? p.method.replace(/_/g, " ") : "", amount: Number(p.amount), photos: [],
    })),
    ...pos.map((p) => ({
      entity: "purchase_order" as const, entityId: p.id, date: p.received_date, type: TYPE_LABEL.purchase_order,
      paidTo: nameOf(p.supplier), details: `PO ${p.order_number}`, amount: Number(p.total_cost), photos: [],
    })),
  ];
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.entityId - b.entityId);

  type Photo = { id: number; entity_type: ReceiptEntity; entity_id: number; file_path: string; ai_total: number | null; amount_mismatch: boolean; ai_status: string };
  const byKey = new Map(rows.map((r) => [`${r.entity}:${r.entityId}`, r]));
  for (const entity of ["expense", "supplier_payment", "purchase_order"] as const) {
    const ids = rows.filter((r) => r.entity === entity).map((r) => r.entityId);
    const photos = await chunked<Photo>(ids, async (part) => {
      const { data } = await db.from("receipt_photos")
        .select("id, entity_type, entity_id, file_path, ai_total, amount_mismatch, ai_status")
        .eq("entity_type", entity).in("entity_id", part).order("id");
      return (data ?? []) as Photo[];
    });
    for (const p of photos) {
      const row = byKey.get(`${p.entity_type}:${p.entity_id}`);
      if (!row) continue;
      const ext = p.file_path.split(".").pop() || "jpg";
      const n = row.photos.length + 1;
      row.photos.push({
        id: p.id, filePath: p.file_path, aiTotal: p.ai_total === null ? null : Number(p.ai_total), mismatch: p.amount_mismatch, aiStatus: p.ai_status,
        fileName: `${row.date}_${SHORT[row.entity]}-${row.entityId}${n > 1 ? `_page${n}` : ""}.${ext}`,
      });
    }
  }
  return rows;
}
