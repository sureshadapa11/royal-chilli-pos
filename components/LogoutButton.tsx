"use client";

import { freshStart } from "@/lib/auth-sync";

export default function LogoutButton({ className }: { className?: string }) {
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    freshStart("/login");
  }

  return (
    <button
      onClick={handleLogout}
      className={className || "px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-semibold rounded-lg border border-red-300"}
    >
      Logout
    </button>
  );
}
