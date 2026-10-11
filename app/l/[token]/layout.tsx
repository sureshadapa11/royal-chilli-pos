import type { Metadata } from "next";

// Staff links: never indexed, never cached by search engines.
export const metadata: Metadata = { title: "Staff forms", robots: { index: false, follow: false } };

export default function StaffLinkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
