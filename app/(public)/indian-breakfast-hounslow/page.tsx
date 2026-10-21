import type { Metadata } from "next";
import LocalPage, { localPageMetadata, type LocalSection } from "@/components/site/LocalPage";

// "indian breakfast hounslow" / "south indian breakfast hounslow" — searched
// often nearby (Google suggestions, October 2026). Breakfast isn't on the
// till's menu, so the dishes are copied from the breakfast menu poster
// (public/menu-posters/breakfast.jpeg, the October 2026 menu the owner put on
// Google). Owner: don't state breakfast times anywhere (October 2026).
export const metadata: Metadata = localPageMetadata(
  "South Indian Breakfast in Hounslow | The Royal Chilli",
  "South Indian breakfast in Hounslow: dosas from £4.95, idli, vada, pongal, poori and parotta at The Royal Chilli, near Hounslow East station.",
  "/og/breakfast.jpg",
);

const SECTIONS: LocalSection[] = [
  {
    heading: "Dosa of Your Choice",
    dishes: [
      { name: "Plain Dosa", price: 4.95, note: "Classic crispy dosa served with sambar and chutneys. Add masala for £1." },
      { name: "Ghee Roast Dosa", price: 5.95, note: "Golden, crispy dosa finished with ghee. Add masala for £1." },
      { name: "Royal Chilli Special Rameshwaram Masala Dosa", price: 6.95 },
      { name: "Podi Dosa", price: 5.95, note: "Dosa coated with spicy podi and ghee. Add masala for £1." },
      { name: "Karam Dosa", price: 5.95, note: "Dosa spread with house-style chilli karam. Add masala for £1." },
      { name: "Pesarattu", price: 7.95, note: "Andhra-style green moong dal dosa served with chutneys and sambar. Add onion or upma for £1." },
      { name: "Onion Dosa", price: 5.95, note: "Crispy dosa topped with chopped onions and herbs." },
      { name: "Paneer Dosa", price: 6.95, note: "Filled with spiced paneer, onions and peppers. Add butter masala for £1." },
      { name: "Cheese Dosa", price: 5.95, note: "Filled with melted cheese." },
      { name: "Egg Dosa", price: 5.95, note: "Layered with seasoned egg." },
      { name: "Chicken Dosa", price: 7.49, note: "Filled with house-spiced chicken masala. Choose mutton for £1 extra." },
      { name: "Chocolate Dosa", price: 5.95, note: "Filled with melted chocolate." },
      { name: "Pizza Uttapam", price: 7.95, note: "Topped with pizza sauce, cheese, onions, peppers and herbs." },
      { name: "Plain Uttapam", price: 7.95 },
      { name: "Kai Dosa", price: 5.95 },
      { name: "Rava Dosa", price: 5.95 },
      { name: "Onion Rava Dosa", price: 6.49 },
    ],
  },
  {
    heading: "Idli & Vada",
    dishes: [
      { name: "Idli (3 pieces)", price: 3.45 },
      { name: "Vada", price: 3.45 },
      { name: "Idli Vada (2 idli, 1 vada)", price: 3.45 },
      { name: "Sambar Vada", price: 3.99 },
      { name: "Dahi Vada", price: 3.99 },
      { name: "Mini Idli", price: 5.25 },
      { name: "Ghee Podi Idli (2 pieces)", price: 4.99 },
      { name: "Podi Masala Idli (10 pieces)", price: 5.49 },
      { name: "Fried Idli", price: 4.99 },
      { name: "Chilli Idli", price: 5.25 },
    ],
  },
  {
    heading: "Pongal",
    dishes: [
      { name: "Pongal", price: 4.95 },
      { name: "Pongal Vada", price: 5.49 },
    ],
  },
  {
    heading: "Poori & Bhature",
    dishes: [
      { name: "Poori (2 pieces)", price: 4.99 },
      { name: "Sambar Poori (3 pieces)", price: 4.99 },
      { name: "Chole Bhature", price: 4.99 },
    ],
  },
  {
    heading: "Parotta",
    dishes: [
      { name: "Malabar Parotta", price: 1.99 },
      { name: "Parotta with Chicken Curry", price: 5.25 },
      { name: "Parotta with Lamb Curry", price: 5.99 },
      { name: "Chilli Parotta", price: 5.25 },
      { name: "Veg Kothu Parotta", price: 4.99 },
      { name: "Egg Kothu Parotta", price: 5.99 },
      { name: "Chicken Kothu Parotta", price: 5.99 },
      { name: "Mutton Kothu Parotta", price: 6.95 },
    ],
  },
];

export default function BreakfastPage() {
  return (
    <LocalPage
      kicker="Breakfast · Hounslow"
      title={<>South Indian <span className="italic text-primary">Breakfast</span> in Hounslow</>}
      intro={[
        "Start the day with a proper South Indian breakfast: soft idli, crispy vada, dosas straight off the tawa, pongal, poori and Malabar parotta.",
        "Choose from 17 dosas and uttapams, from a classic Plain Dosa at £4.95 to our Royal Chilli Special Rameshwaram Masala Dosa.",
      ]}
      points={["Halal", "Fresh South Indian breakfast", "3 min from Hounslow East"]}
      sections={SECTIONS}
    />
  );
}
