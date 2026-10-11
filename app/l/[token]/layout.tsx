import type { Metadata, Viewport } from "next";

// Staff links: never indexed; "Add to Home Screen" opens them like an app.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "Staff forms",
    robots: { index: false, follow: false },
    manifest: `/l/${token}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "Staff forms", statusBarStyle: "default" },
    icons: { apple: "/icon-192.png" },
  };
}

export const viewport: Viewport = { themeColor: "#e4473a", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function StaffLinkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
