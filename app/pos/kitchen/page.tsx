import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import KitchenBoard from "@/components/kitchen/KitchenBoard";

export default async function KitchenPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const kitchenOnly = session.role === "kitchen";

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex-1 overflow-hidden">
        <KitchenBoard kitchenOnly={kitchenOnly} />
      </div>
    </div>
  );
}
