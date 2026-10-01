import { SteamChoice } from "@/components/steam-choice";
import { PRIVATE_ROBOTS } from "@/lib/seo";

export const metadata = {
  title: "Steam verified",
  description: "Choose how to continue with your verified Steam identity.",
  robots: PRIVATE_ROBOTS,
};
export const dynamic = "force-dynamic";

export default function Page() {
  return <SteamChoice />;
}
