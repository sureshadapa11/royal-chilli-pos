import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import {
  ALL_ROLES,
  TAB_KEYS,
  TAB_LABELS,
  ROLE_LABELS,
  getPermissionMatrix,
  refreshPermissionsCache,
} from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const matrix = await getPermissionMatrix();
  return NextResponse.json({
    matrix,
    roles: ALL_ROLES,
    tabs: TAB_KEYS,
    tabLabels: TAB_LABELS,
    roleLabels: ROLE_LABELS,
  });
}

// Admin only — a manager must not be able to grant themselves other tabs.
export async function PUT(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, permission, granted } = await req.json();
    if (
      !ALL_ROLES.includes(role) ||
      !(TAB_KEYS as readonly string[]).includes(permission) ||
      typeof granted !== "boolean"
    ) {
      return NextResponse.json({ error: "Invalid role, tab, or value" }, { status: 400 });
    }
    // Super admin always has everything; Front House and Kitchen never see
    // Staff Hub — none of them is editable.
    if (role === "admin" || role === "employee" || role === "kitchen") {
      return NextResponse.json({ error: `${ROLE_LABELS[role as keyof typeof ROLE_LABELS]} access is fixed` }, { status: 400 });
    }

    const { error } = await supabase
      .from("role_permissions")
      .upsert({ role, permission, granted }, { onConflict: "role,permission" });
    if (error) throw error;

    await refreshPermissionsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Permissions update error:", error);
    return NextResponse.json({ error: "Failed to update permission" }, { status: 500 });
  }
}
