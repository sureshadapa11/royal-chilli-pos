import { bizDb } from "@/lib/business-db";
import { groupsOf, joinLabel, placeTables } from "@/lib/floor-plan";

// Joined tables, server side (see app/api/tables/join and lib/floor-plan.ts).

type Db = ReturnType<typeof bizDb>;
export type JoinRow = {
  id: number; table_number: string; capacity: number;
  pos_x: number | null; pos_y: number | null; joined_to: number | null; group_name: string | null;
};

/** Every table of the business, placed on the plan. */
export async function placedTables(db: Db) {
  const { data, error } = await db.from("restaurant_tables").select("id, table_number, capacity, pos_x, pos_y, joined_to, group_name");
  if (error) throw error;
  return placeTables((data || []) as JoinRow[]);
}

/** Rewrites a lead table's "T1 + T2 · name" label from its current members. */
export async function refreshJoinLabel(db: Db, leadId: number) {
  const g = groupsOf(await placedTables(db)).find((x) => x.lead.id === leadId);
  if (!g) return;
  await db.from("restaurant_tables")
    .update({ join_label: g.members.length > 1 ? joinLabel(g.members, g.lead.group_name) : null })
    .eq("id", leadId);
}
