import { getCustomerSession } from "@/lib/customer-auth";
import supabase from "@/lib/supabase";
import AccountView from "@/components/site/AccountView";

export default async function AccountProfilePage() {
  const session = await getCustomerSession();
  if (!session) return null; // layout already redirects

  const { data: customer } = await supabase
    .from("customers")
    .select("name, phone, email, marketing_consent, date_of_birth")
    .eq("id", session.id)
    .maybeSingle();

  const { data: addresses } = await supabase
    .from("customer_addresses")
    .select("id, label, line, postcode, is_default")
    .eq("customer_id", session.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  const [firstName, ...rest] = (customer?.name || "").split(" ");

  return (
    <AccountView
      initialFirstName={firstName || ""}
      initialLastName={rest.join(" ")}
      initialPhone={customer?.phone || ""}
      email={customer?.email || session.email}
      initialSubscribed={customer?.marketing_consent ?? true}
      initialBirthday={customer?.date_of_birth ?? null}
      initialAddresses={addresses || []}
    />
  );
}
