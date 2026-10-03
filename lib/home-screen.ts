// Shown under the home-screen icon, which fits about 12 characters: the
// business code for a till ("RC Till"), and the name for the Staff Hub when
// it fits ("Melt House"), else the code ("RC Staff"). Never cut mid-word.
const FITS = 12;
export function shortName(name: string, code: string | null, till: boolean): string {
  if (till) return code ? `${code} Till` : "Till";
  if (name.length <= FITS) return name;
  return code ? `${code} Staff` : "Staff Hub";
}
