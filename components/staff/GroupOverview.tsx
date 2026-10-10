import type { GroupOverview as Data } from "@/lib/group-dashboard";

const money = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Owner only: every business side by side for the dashboard's date range.
// Switch business (header) to open any of them in full.
export default function GroupOverview({ data, current }: { data: Data; current: number }) {
  const cell = "px-3 py-2.5 text-right tabular-nums whitespace-nowrap";
  return (
    <section className="mb-6 rounded-2xl border border-border bg-white p-4 shadow-[0_1px_2px_rgba(32,27,24,0.04)]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-[17px] font-semibold text-foreground">All businesses</h2>
        <p className="text-[12.5px] text-muted-foreground">{data.from} to {data.to} · same figures as each business&apos;s dashboard, Finance and Daily accounts</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13.5px]">
          <thead className="text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Business</th>
              <th className="px-3 py-2 text-right font-semibold">Total sales</th>
              <th className="px-3 py-2 text-right font-semibold">Ex-VAT</th>
              <th className="px-3 py-2 text-right font-semibold">Staff cost</th>
              <th className="px-3 py-2 text-right font-semibold">All costs</th>
              <th className="px-3 py-2 text-right font-semibold">Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.rows.map((r) => (
              <tr key={r.id} className={r.id === current ? "bg-[#FDF6EC]" : ""}>
                <td className="px-3 py-2.5 font-medium text-foreground">
                  {r.name}
                  {!r.active && <span className="ml-2 rounded bg-[#F6F1E6] px-1.5 py-0.5 text-[11px] text-muted-foreground">not open yet</span>}
                  {r.id === current && <span className="ml-2 text-[11px] text-muted-foreground">working in</span>}
                </td>
                <td className={cell}>{money(r.totalSales)}</td>
                <td className={cell}>{money(r.exVat)}</td>
                <td className={cell}>{money(r.staff)}</td>
                <td className={cell}>{money(r.costs)}</td>
                <td className={`${cell} font-semibold ${r.profit < 0 ? "text-[#C0392B]" : "text-foreground"}`}>{money(r.profit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="px-3 py-2.5 text-foreground">Total</td>
              <td className={cell}>{money(data.total.totalSales)}</td>
              <td className={cell}>{money(data.total.exVat)}</td>
              <td className={cell}>{money(data.total.staff)}</td>
              <td className={cell}>{money(data.total.costs)}</td>
              <td className={`${cell} ${data.total.profit < 0 ? "text-[#C0392B]" : "text-foreground"}`}>{money(data.total.profit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
        <b>Total sales</b> = Z report (tips not included) + Just Eat + Deliveroo + Uber Eats + Hiest + catering paid · <b>Ex-VAT</b> = Total sales ÷ 1.2 ·{" "}
        <b>All costs</b> = stock received + expenses (VAT claimed back taken off) + card fee + till paid out + staff wages + platform commission · <b>Profit</b> = Ex-VAT − All costs
      </p>
    </section>
  );
}
