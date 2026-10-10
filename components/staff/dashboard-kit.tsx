// Shared pieces of the Staff Hub dashboard: card frame, legend, chart styling
// and money formats. Fixed colour per channel / source (never by rank), one
// y-axis per chart, hover tooltips everywhere, legends on multi-series charts.

export const S = { s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a", s4: "#eda100", s5: "#e87ba4", s6: "#4a3aa7", s7: "#14969a", neutral: "#B9B0A4" };
export const CHANNEL_COLOUR: Record<string, string> = {
  dine_in: S.s1, takeaway: S.s2, delivery: S.s3, just_eat: S.s4, uber_eats: S.s5, deliveroo: S.s6, hiest: S.s7,
};
// Sales by source: the till (Z report), delivery platforms together, catering.
export const SOURCE_COLOUR = { till: S.s1, platforms: S.s2, catering: S.s3 };
export const PREV = "#A79D90";     // the period before, always a quiet grey line
export const COST = "#B4532A";     // money out
export const HOURS = S.s6;
export const GRID = "#F0EBDF";
export const INK = "#201B18";
export const INK_2 = "#5B524B";
export const INK_MUTED = "#8A8078";
export const GOOD = "#1F7A4D";
export const BAD = "#C0392B";
export const TOOLTIP = { borderRadius: 10, border: "1px solid #ECE5D6", fontSize: 12.5, boxShadow: "0 8px 24px -8px rgba(32,27,24,0.18)" };
export const AXIS = { fontSize: 11.5, fill: INK_MUTED };
export const heading = { fontFamily: "var(--font-space-grotesk)" };

export const gbp = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
export const gbp2 = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const money = (v: unknown) => gbp2(Number(v));

export function Card({ title, sub, action, children, className = "" }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-[#ECE5D6] bg-white px-[18px] py-4 ${className}`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 style={heading} className="text-[15px] font-semibold text-foreground">{title}</h2>
        {sub && <span className="text-[12.5px] text-muted-foreground">{sub}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; colour: string; line?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-[#5B524B]">
      {items.map((i) => (
        <span key={i.label}>
          <i className={`mr-1.5 inline-block align-[-1px] ${i.line ? "h-[2px] w-3.5 rounded-sm align-[3px]" : "h-2.5 w-2.5 rounded-[3px]"}`} style={{ background: i.colour }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** A small label + figure tile. */
export function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0 rounded-xl bg-[#FBF8F1] px-3 py-2">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{label}</span>
      <b style={{ ...heading, color: tone === "good" ? GOOD : tone === "bad" ? BAD : undefined }} className="mt-0.5 block truncate text-[16.5px] font-bold tabular-nums">{value}</b>
    </div>
  );
}

/** ▲ / ▼ % against an earlier figure, or a plain note when there's nothing to compare. */
export function Change({ cur, prev, label }: { cur: number; prev: number; label: string }) {
  if (!prev) return cur ? <span className="inline-block rounded-full bg-[#EFEAE0] px-2.5 py-0.5 text-[12px] font-semibold text-[#5B524B]">No {label.toLowerCase()} figures to compare</span> : null;
  const pct = Math.round(((cur - prev) / prev) * 1000) / 10;
  const up = pct >= 0;
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${up ? "bg-[#E7F5EC]" : "bg-[#FDECE9]"}`} style={{ color: up ? GOOD : BAD }}>
      {up ? "▲" : "▼"} {Math.abs(pct).toLocaleString("en-GB")}% <span className="font-normal">vs {label.toLowerCase()}</span>
    </span>
  );
}
