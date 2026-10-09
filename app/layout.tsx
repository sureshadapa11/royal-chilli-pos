import type { Metadata, Viewport } from "next";
import { Poppins, Playfair_Display, Cinzel, Work_Sans, Space_Grotesk } from "next/font/google";
import PwaRegister from "@/components/PwaRegister";
import AuthSync from "@/components/AuthSync";
import "./globals.css";
import { SITE_URL } from "@/lib/site-url";
import { ConfirmHost } from "@/components/ui/confirm";

const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-poppins" });

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
});

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["700", "900"],
  variable: "--font-cinzel",
});

const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["300", "400"],
  variable: "--font-worksans",
});

// Base font for the entire back office — Staff Hub, POS till and the staff
// login page (applied at each area's layout, see StaffShell.tsx and
// app/pos|login/layout.tsx) — set inline there rather than on <body> here so
// the public-facing website keeps its own Poppins/Playfair/Cinzel branding.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
});

// Neutral defaults: this app serves every business and the shared staff
// sign-in (crewportal), so nothing here names one business. Each business's
// website (app/(public)/layout.tsx), sign-in and home-screen app
// (app/manifest.json) add their own name.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Staff sign in",
  description: "Staff sign-in, till and back office.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#E34234",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${poppins.variable} ${playfair.variable} ${cinzel.variable} ${workSans.variable} ${spaceGrotesk.variable} ${poppins.className} antialiased`}>
        <PwaRegister />
        <AuthSync />
        {children}
        <ConfirmHost />
      </body>
    </html>
  );
}
