import type { Metadata } from "next";
import LocalPage, { localPageMetadata } from "@/components/site/LocalPage";
import { getActiveMenu } from "@/lib/menu";
import { pageBusinessId } from "@/lib/business";

// "halal restaurant hounslow" / "halal food hounslow" — searched often nearby
// (Google suggestions, October 2026). Halal confirmed by the owner 2026-10-19.
// Dishes and prices from the live menu: grills and non-vegetarian starters.
export const metadata: Metadata = localPageMetadata(
  "Halal Indian Restaurant in Hounslow | The Royal Chilli",
  "Halal Indian restaurant in Hounslow: Hyderabadi biryani, tandoori grills, lamb chops and curries at The Royal Chilli, 3 minutes from Hounslow East station.",
  "/og/restaurant.jpg",
);

export default async function HalalPage() {
  const menu = await getActiveMenu(await pageBusinessId(), "pos").catch(() => []);
  const pick = (re: RegExp) => menu.filter((c) => re.test(c.name)).flatMap((c) => c.items)
    .map((i) => ({ name: i.name, price: Number(i.price), note: i.description }));
  return (
    <LocalPage
      kicker="Halal · Hounslow"
      title={<>Halal Indian <span className="italic text-primary">Restaurant</span> in Hounslow</>}
      intro={[
        "The Royal Chilli is fully halal. From Hyderabadi dum biryani and tandoori grills to lamb chops and curries, you can order anything on the menu with confidence.",
        "We're on Kingsley Road with our own free car park, and open late every night, so it's an easy choice for family meals and get-togethers.",
      ]}
      points={["Fully halal", "Free on-site parking", "Open till 1am", "3 min from Hounslow East"]}
      sections={[
        { heading: "Grills", dishes: pick(/grill/i) },
        { heading: "Non-Vegetarian Starters", dishes: pick(/^non-?veg.*starter/i) },
        { heading: "Biryanis", dishes: pick(/biryani/i) },
      ]}
    />
  );
}

