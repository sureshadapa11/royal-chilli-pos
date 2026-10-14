import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getOrderForPrint } from "@/lib/kot";
import { hasAllergy, allergyText } from "@/lib/allergy";
import { getBrand } from "@/lib/brand";
import AutoPrint from "./AutoPrint";
import PrintNav from "./PrintNav";

export default async function KotPrintPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const data = await getOrderForPrint(Number((await params).orderId));
  // Only an order of the business this login is working for.
  if (!data || (data.order as { business_id?: number }).business_id !== session.businessId) {
    return <div style={{ padding: 20, fontFamily: "monospace" }}>Order not found.</div>;
  }
  const { order, items } = data;
  const brand = await getBrand(session.businessId);

  return (
    <>
      <AutoPrint />
      <PrintNav />
      <div className="kot-ticket">
        <p className="center bold big">{brand.name.toUpperCase()}</p>
        <p className="center">KITCHEN ORDER TICKET</p>
        <div className="divider" />
        <p className="bold big">{order.table_number ? `TABLE ${order.table_number}` : order.order_type.toUpperCase()}</p>
        <p>Order: {order.order_number}</p>
        <p>{new Date(order.created_at).toLocaleString("en-GB")}</p>
        {order.customer_name && <p>Customer: {order.customer_name}</p>}
        {hasAllergy(order) && (<>
          <div className="divider" />
          <p className="center bold big">!! ALLERGY !!</p>
          <p className="center bold">{allergyText(order).toUpperCase()}</p>
        </>)}
        <div className="divider" />
        {items.map((item) => (
          <div key={item.id} className="item">
            <p className="bold">{item.quantity}x {item.item_name}</p>
            {item.modifiers.length > 0 && <p className="indent">- {item.modifiers.join(", ")}</p>}
            {item.notes && <p className="indent">** {item.notes}</p>}
          </div>
        ))}
        <div className="divider" />
        {order.notes && <p>Note: {order.notes}</p>}
        <p className="center" style={{ marginTop: 12 }}>Printed {new Date().toLocaleTimeString("en-GB")}</p>
      </div>

      <style>{`
        body { background: #fff; }
        .kot-ticket {
          width: 80mm;
          margin: 0 auto;
          padding: 8px;
          font-family: 'Courier New', monospace;
          color: #000;
          font-size: 13px;
          line-height: 1.4;
        }
        .kot-ticket p { margin: 2px 0; }
        .center { text-align: center; }
        .bold { font-weight: 700; }
        .big { font-size: 16px; }
        .indent { padding-left: 12px; font-size: 12px; }
        .divider { border-top: 1px dashed #000; margin: 6px 0; }
        .item { margin-bottom: 4px; }
        @media print {
          @page { size: 80mm auto; margin: 0; }
          body { margin: 0; }
          .no-print { display: none; }
        }
      `}</style>
    </>
  );
}
