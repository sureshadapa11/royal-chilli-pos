import type { Metadata } from "next";
import LocalPage, { type LocalSection } from "@/components/site/LocalPage";

// "indian breakfast hounslow" / "south indian breakfast hounslow" — searched
// often nearby (Google suggestions, October 2026). Breakfast isn't on the
// till's menu, so the dishes are copied from the breakfast poster
// (public/menu-posters/breakfast.jpeg). The poster's starred prices (Kottu
// Parotta, Poori + Keema) are marked unconfirmed there, so they're left out;
// breakfast hours too, until confirmed.
export const metadata: Metadata = {
  title: "South Indian Breakfast in Hounslow | The Royal Chilli",
  description: "South Indian breakfast in Hounslow: idly, vada, dosas, poori, pongal and a £6.99 full breakfast combo at The Royal Chilli, near Hounslow East station.",
};

const SECTIONS: LocalSection[] = [
  {
    heading: "Breakfast",
    dishes: [
      { name: "Vada (2)", price: 3.99 },
      { name: "Idly (3)", price: 3.99 },
      { name: "Plain Dosa", price: 3.99 },
      { name: "Onion Dosa", price: 4.99 },
      { name: "Ghee Cheese Dosa", price: 4.99 },
      { name: "Kaju Dosa", price: 4.99 },
      { name: "Masala Dosa", price: 4.99 },
      { name: "Poori Masala (2)", price: 4.99 },
      { name: "Pongal", price: 4.99 },
      { name: "Khichdi", price: 4.99 },
      { name: "Chapathi (2)", price: 4.99 },
      { name: "Paratha (2)", price: 5.99 },
      { name: "Mysore Masala Dosa", price: 6.99 },
      { name: "Mysore Bonda (6)", price: 5.99 },
    ],
  },
  {
    heading: "Breakfast Combos",
    dishes: [
      { name: "Full Breakfast Combo", price: 6.99, note: "Idly (2), vada, poori, mini masala dosa and a sweet." },
      { name: "Vada + Chicken Curry", price: 5.99 },
      { name: "Poori + Chicken Curry", price: 5.99 },
      { name: "Idly + Chicken Curry", price: 5.99 },
      { name: "Idly + Lamb Curry", price: 6.49 },
      { name: "Dosa + Paneer", price: 6.99 },
      { name: "Dosa + Chicken", price: 7.45 },
      { name: "Dosa + Lamb", price: 7.99 },
    ],
  },
  {
    heading: "Drinks",
    dishes: [
      { name: "Tea", price: 1.0 },
      { name: "Coffee", price: 1.0 },
    ],
  },
];

export default function BreakfastPage() {
  return (
    <LocalPage
      kicker="Breakfast · Hounslow"
      title={<>South Indian <span className="italic text-primary">Breakfast</span> in Hounslow</>}
      intro={[
        "Start the day with a proper South Indian breakfast: soft idly, crispy vada, dosas straight off the tawa, poori masala and pongal, served every morning.",
        "Hungry? The Full Breakfast Combo brings idly, vada, poori, a mini masala dosa and a sweet together for £6.99.",
      ]}
      points={["Halal", "Breakfast every morning", "3 min from Hounslow East"]}
      sections={SECTIONS}
    />
  );
}
