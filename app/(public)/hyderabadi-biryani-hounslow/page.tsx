import type { Metadata } from "next";
import LocalPage, { localPageMetadata } from "@/components/site/LocalPage";
import { getActiveMenu } from "@/lib/menu";
import { pageBusinessId } from "@/lib/business";

// "hyderabadi biryani hounslow" is the dish search people make most near the
// restaurant (Google suggestions, October 2026). Dishes and prices come from
// the live menu's Biryanis section.
export const metadata: Metadata = localPageMetadata(
  "Hyderabadi Biryani in Hounslow | The Royal Chilli",
  "Hyderabadi dum biryani in Hounslow: lamb, chicken, Nalli Gosht, prawn and vegetarian biryani at The Royal Chilli, 3 minutes from Hounslow East station.",
  "/og/biryani.jpg",
);

export default async function BiryaniPage() {
  const menu = await getActiveMenu(await pageBusinessId(), "pos").catch(() => []);
  const biryanis = menu.filter((c) => /biryani/i.test(c.name)).flatMap((c) => c.items);
  return (
    <LocalPage
      kicker="Hyderabadi Biryani · Hounslow"
      title={<>Hyderabadi <span className="italic text-primary">Dum Biryani</span> in Hounslow</>}
      intro={[
        "Our signature lamb and chicken dum biryanis are made Hyderabadi style: rice and meat layered, sealed and slow-cooked together.",
        "There's also Nalli Gosht, prawn, Chicken 65, chicken tikka and vegetarian biryani. Enjoy it in the restaurant or call us to order for collection.",
      ]}
      points={["Halal", "Dine in", "Collection", "3 min from Hounslow East"]}
      sections={[{ heading: "Our Biryanis", dishes: biryanis.map((i) => ({ name: i.name, price: Number(i.price), note: i.description, veg: !!i.is_veg })) }]}
    />
  );
}
