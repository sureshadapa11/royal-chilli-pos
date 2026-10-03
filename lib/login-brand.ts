import { businessByLoginCode, businessForHostOrNull } from "@/lib/business";

// What the staff sign-in shows. The business comes from the address it was
// opened on (staff.melthouse.co.uk), else from the business code typed at the
// shared sign-in (crewportal.vercel.app/staff), else a ?b=<slug> link. With
// none of those it asks for the business code — never another business's
// name or logo. Only the name, logo and colour are shown: no address, clock
// or till options.
export type LoginBrand =
  | {
      found: true;
      name: string;
      logoUrl: string | null;
      colour: string | null;
      /** The business code sent with the sign-in (null if it has none). */
      code: string | null;
      /** Picked by business code (not the address), so it can be changed. */
      viaCode: boolean;
    }
  | { found: false; badCode: boolean };

const HEX = /^#[0-9a-f]{6}$/i;

export async function loginBrand(
  host: string | null | undefined,
  pick?: string | null,
  code?: string | null
): Promise<LoginBrand> {
  // If the businesses can't be read, still show something usable.
  const safe = <T,>(p: Promise<T>) => p.catch((e) => { console.error("Login branding lookup failed:", e); return null; });

  const byHost = await safe(businessForHostOrNull(host, pick));
  const byCode = byHost ? null : await safe(businessByLoginCode(code));
  const b = byHost ?? byCode;
  if (!b) return { found: false, badCode: !!code?.trim() };
  const colour = b.brand_colour?.trim() ?? "";
  return {
    found: true,
    name: b.name,
    logoUrl: b.logo_url || null,
    colour: HEX.test(colour) ? colour : null,
    code: b.login_code ?? null,
    viaCode: !byHost,
  };
}
