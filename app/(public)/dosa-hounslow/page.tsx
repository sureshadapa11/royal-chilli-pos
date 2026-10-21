import type { Metadata } from "next";
import LocalPage, { type LocalDish } from "@/components/site/LocalPage";
import { getActiveMenu, type MenuItem } from "@/lib/menu";
import { pageBusinessId } from "@/lib/business";

// "dosa" / "dosa near me" / "south indian restaurant hounslow" are searched
// about five times more than biryani when people find us on Google (Business
// Profile search terms, October 2026). Dishes and prices come from the live
// menu's DOSA MENU and the idli & vada in Breakfast. Owner: don't state
// breakfast times anywhere.
export const metadata: Metadata = {
  title: "Dosa & South Indian Restaurant in Hounslow | The Royal Chilli",
  description: "Crispy dosas in Hounslow from £4.95: masala, ghee roast, Rameshwaram, podi, paneer and chicken dosa, plus idli and vada at The Royal Chilli, 3 min from Hounslow East.",
};

const toDish = (i: MenuItem): LocalDish => ({ name: i.name, price: Number(i.price), note: i.description, veg: !!i.is_veg });

export default async function DosaPage() {
  const menu = await getActiveMenu(await pageBusinessId(), "pos").catch(() => []);
  const dosas = menu.filter((c) => /dosa/i.test(c.name)).flatMap((c) => c.items);
  const idliVada = menu.filter((c) => /breakfast/i.test(c.name)).flatMap((c) => c.items).filter((i) => /idli|vada/i.test(i.name));
  return (
    <LocalPage
      kicker="Dosa · South Indian · Hounslow"
      title={<>Crispy <span className="italic text-primary">Dosas</span> in Hounslow</>}
      intro={[
        "Our dosas are made fresh on the tawa from a fermented rice and lentil batter, thin and crispy, and served with sambar and coconut chutney.",
        "Try a classic Masala Dosa, a Ghee Roast, a spicy Podi or Karam Dosa, or our Royal Chilli Special Rameshwaram Masala Dosa. Pair it with soft idli or crispy vada.",
      ]}
      points={["Halal", "Vegetarian options", "Dine in", "Collection", "3 min from Hounslow East"]}
      photos={[
        { src: "/gallery/Masala_Dosa.webp", alt: "Masala Dosa at The Royal Chilli, Hounslow" },
        { src: "/gallery/Plain_Dosa.webp", alt: "Plain Dosa at The Royal Chilli, Hounslow" },
        { src: "/gallery/Masala_Wada.webp", alt: "Vada at The Royal Chilli, Hounslow" },
      ]}
      sections={[
        { heading: "Dosas & Uttapams", dishes: dosas.map(toDish) },
        { heading: "Idli & Vada", dishes: idliVada.map(toDish) },
      ]}
    />
  );
}
