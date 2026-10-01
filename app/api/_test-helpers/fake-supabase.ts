// A tiny in-memory stand-in for the Supabase query builder, for tests that
// need filters (eq / in / gte / …) to actually apply. Wire it up with:
//   jest.mock("@/lib/supabase", () => ({ __esModule: true, default: require("@/app/api/_test-helpers/fake-supabase").fakeSupabase }));
// and seed rows with fakeDb.reset({ table: [...] }).
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export const fakeDb = {
  tables: {} as Record<string, Row[]>,
  nextId: 1000,
  reset(data: Record<string, Row[]>) {
    this.tables = Object.fromEntries(Object.entries(data).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
    this.nextId = 1000;
  },
  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  },
};

// PostgREST sends every filter value as text, so "13" matches the int 13.
const same = (a: unknown, b: unknown) => a === b || (a != null && b != null && String(a) === String(b));
const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const num = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" ? a - b : cmp(a, b);

// "id, name, supplier:suppliers(name)" → embeds: [{ alias: "supplier", table: "suppliers" }]
function embeds(columns: string): { alias: string; table: string }[] {
  return [...columns.matchAll(/(\w+):(\w+)\(([^)]*)\)/g)].map((m) => ({ alias: m[1], table: m[2] }));
}

function builder(table: string) {
  const filters: Filter[] = [];
  const orders: { col: string; asc: boolean }[] = [];
  let range: [number, number] | null = null;
  let limit: number | null = null;
  let columns = "*";
  let mode: "select" | "insert" | "delete" | "update" = "select";
  let payload: Row[] = [];
  let patch: Row = {};

  const run = (): { data: unknown; error: null } => {
    if (mode === "insert") {
      const inserted = payload.map((r) => ({ id: r.id ?? fakeDb.nextId++, ...r }));
      fakeDb.rows(table).push(...inserted);
      return { data: inserted, error: null };
    }
    const all = fakeDb.rows(table);
    const matched = all.filter((r) => filters.every((f) => f(r)));
    if (mode === "delete") {
      fakeDb.tables[table] = all.filter((r) => !matched.includes(r));
      return { data: matched, error: null };
    }
    if (mode === "update") {
      for (const r of matched) Object.assign(r, patch);
      return { data: matched, error: null };
    }
    let out = [...matched];
    for (const o of [...orders].reverse()) out.sort((a, b) => (o.asc ? 1 : -1) * num(a[o.col], b[o.col]));
    if (range) out = out.slice(range[0], range[1] + 1);
    if (limit != null) out = out.slice(0, limit);
    const joins = embeds(columns);
    out = out.map((r) => {
      const copy: Row = { ...r };
      for (const j of joins) copy[j.alias] = fakeDb.rows(j.table).find((p) => p.id === r[`${j.alias}_id`]) ?? null;
      return copy;
    });
    return { data: out, error: null };
  };

  const b: Record<string, unknown> = {
    select(cols?: string) { if (cols) columns = cols; return b; },
    insert(v: Row | Row[]) { mode = "insert"; payload = Array.isArray(v) ? v : [v]; return b; },
    upsert(v: Row | Row[]) { mode = "insert"; payload = Array.isArray(v) ? v : [v]; return b; },
    update(v: Row) { mode = "update"; patch = v; return b; },
    delete() { mode = "delete"; return b; },
    eq(c: string, v: unknown) { filters.push((r) => same(r[c], v)); return b; },
    neq(c: string, v: unknown) { filters.push((r) => !same(r[c], v)); return b; },
    in(c: string, v: unknown[]) { filters.push((r) => v.some((x) => same(r[c], x))); return b; },
    gte(c: string, v: unknown) { filters.push((r) => num(r[c], v) >= 0); return b; },
    lte(c: string, v: unknown) { filters.push((r) => num(r[c], v) <= 0); return b; },
    gt(c: string, v: unknown) { filters.push((r) => num(r[c], v) > 0); return b; },
    lt(c: string, v: unknown) { filters.push((r) => num(r[c], v) < 0); return b; },
    is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return b; },
    not(c: string, op: string, v: unknown) {
      if (op !== "is") throw new Error(`fake-supabase: unsupported not(${op})`);
      filters.push((r) => (r[c] ?? null) !== v);
      return b;
    },
    order(c: string, o?: { ascending?: boolean }) { orders.push({ col: c, asc: o?.ascending !== false }); return b; },
    range(a: number, z: number) { range = [a, z]; return b; },
    limit(n: number) { limit = n; return b; },
    maybeSingle() {
      const { data } = run();
      return Promise.resolve({ data: (data as Row[])[0] ?? null, error: null });
    },
    single() {
      const { data } = run();
      const row = (data as Row[])[0];
      return Promise.resolve(row ? { data: row, error: null } : { data: null, error: new Error("No rows") });
    },
    then(resolve: (v: { data: unknown; error: null }) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve().then(run).then(resolve, reject);
    },
  };
  return b;
}

export const fakeSupabase = { from: (table: string) => builder(table) };
