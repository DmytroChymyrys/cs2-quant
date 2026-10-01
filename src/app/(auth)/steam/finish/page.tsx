import { redirect } from "next/navigation";
import { currentUser } from "@/lib/product/auth";
import { SteamFinish } from "@/components/steam-finish";
import { PRIVATE_ROBOTS } from "@/lib/seo";

export const metadata = {
  title: "Connecting Steam",
  description: "Connecting your verified Steam identity.",
  robots: PRIVATE_ROBOTS,
};
export const dynamic = "force-dynamic";

export default async function Page() {
  // Reached only after signing in; the endpoint re-checks freshness itself.
  if (!(await currentUser())) redirect("/login?next=/steam/finish");
  return <SteamFinish />;
}
