import type { Metadata } from "next";
import { getTableByNumber } from "@/lib/dine-in";
import { getActiveMenu } from "@/lib/menu";
import { headers } from "next/headers";
import { websiteBusinessId } from "@/lib/business";
import DineInOrder from "@/components/site/DineInOrder";

// QR-only entry point — not meant to be found via search.
export const metadata: Metadata = {
  title: "Table Order — The Royal Chilli",
  robots: { index: false },
};

export default async function TablePage({
  params,
  searchParams,
}: {
  params: Promise<{ tableNumber: string }>;
  searchParams: Promise<{ b?: string }>;
}) {
  const { tableNumber } = await params;
  const { b } = await searchParams;
  const businessId = await websiteBusinessId((await headers()).get("host"), b);
  const table = await getTableByNumber(businessId, tableNumber);

  if (!table) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <div className="text-5xl">🔍</div>
        <h1 className="mt-4 font-[family-name:var(--font-playfair)] text-2xl">Table Not Found</h1>
        <p className="mt-2 text-muted-foreground">
          We couldn&apos;t find table &ldquo;{tableNumber}&rdquo;. Please ask a member of staff for help.
        </p>
      </div>
    );
  }

  const categories = await getActiveMenu(table.business_id);
  return <DineInOrder tableNumber={table.table_number} tableLabel={table.label} businessParam={b ?? null} categories={categories} initialSelfOrderEnabled={table.self_order_enabled} />;
}
