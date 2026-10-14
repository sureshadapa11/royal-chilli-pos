// Settings → How figures work (Super admin, agreed 2026-10-14): the
// explanations that used to sit under the dashboard cards, kept in one place
// so the dashboard shows only figures and charts.

const SECTIONS: { title: string; lines: string[] }[] = [
  {
    title: "Total sales, Ex-VAT and Profit (Summary card, All businesses, Finance, Daily accounts)",
    lines: [
      "Total sales = Z report (tips not included) + Just Eat + Deliveroo + Uber Eats + Hiest + catering paid + events paid.",
      "Ex-VAT = Total sales ÷ 1.2.",
      "All costs = stock received + expenses (VAT claimed back taken off) + card fee + till paid out + staff wages + platform commission.",
      "Profit (Net total) = Ex-VAT − All costs.",
      "The same figures are used on every business's dashboard, the All businesses table, Finance → Profit & Loss and the Daily accounts month sheet.",
    ],
  },
  {
    title: "Money out",
    lines: [
      "Expenses have the VAT you claim back taken off.",
      "Staff wages are clocked-out hours × pay rate, so they show £0 for anyone without a pay rate.",
      "Supplier payments aren't counted again: the stock is counted when its delivery is received.",
    ],
  },
  {
    title: "Delivery platforms",
    lines: [
      "Sales and commission come from each platform's payout summary, typed into the Day End.",
      "Commission % = commission ÷ that platform's sales. The highest % is the platform that costs most per £1 of sales.",
    ],
  },
  {
    title: "Staff vs sales",
    lines: [
      "Hours are clocked-out hours from the Attendance app (breaks taken off).",
      "Until pay rates are added in Staff Hub → Staff, it shows hours only; wages and labour % appear once rates are added.",
    ],
  },
  {
    title: "Daily accounts tile",
    lines: [
      "Daily accounts figures include saved drafts. They are shown separately and don't change sales or profit.",
    ],
  },
  {
    title: "Cash drawer",
    lines: [
      "Expected = Opening + Cash sales + Money in (cash) − Money out (cash) − Bank in.",
      "Variance = Counted − Expected (minus = missing, plus = extra). Only cash counts; card and bank entries don't touch the drawer.",
    ],
  },
  {
    title: "Catering, events and pending bills",
    lines: [
      "Catering and events paid by cash or bank transfer count as sales on the day received; card on our machine is already in the Z report.",
      "Pending bills are tracking only: they don't change sales or the cash check. The month's Pending shows the latest amount owed, not a sum.",
    ],
  },
];

export default function FiguresExplained() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">How the numbers on the dashboard, Finance and Daily accounts are worked out.</p>
      {SECTIONS.map((s) => (
        <section key={s.title} className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-[15px] font-bold text-foreground">{s.title}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13.5px] text-muted-foreground">
            {s.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
