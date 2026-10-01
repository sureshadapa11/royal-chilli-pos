import { businessForHostOrNull } from "@/lib/business";
import { addressOneLine, type Address } from "@/lib/business-setup";

// What the staff login screen shows: the business whose domain (or ?b=<slug>
// link) it was opened on. An unknown domain gets a neutral screen — never
// another business's name or logo. Signing in works either way: staff always
// land in their own business (loginBusinessId).
export type LoginBrand =
  | { found: true; name: string; logoUrl: string | null; colour: string | null; address: string }
  | { found: false };

const HEX = /^#[0-9a-f]{6}$/i;

export async function loginBrand(host: string | null | undefined, pick?: string | null): Promise<LoginBrand> {
  // If the businesses can't be read, still show the sign-in form.
  const b = await businessForHostOrNull(host, pick).catch((e) => {
    console.error("Login branding lookup failed:", e);
    return null;
  });
  if (!b) return { found: false };
  const colour = b.brand_colour?.trim() ?? "";
  return {
    found: true,
    name: b.name,
    logoUrl: b.logo_url || null,
    colour: HEX.test(colour) ? colour : null,
    address: addressOneLine((b.trading_address ?? null) as Address | null) || b.address || "",
  };
}
