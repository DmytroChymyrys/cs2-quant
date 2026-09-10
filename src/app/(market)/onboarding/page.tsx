import { currentUser } from "@/lib/product/auth";
import { marketSnapshot } from "@/lib/product/market";
import { AuthRequired } from "@/components/auth-required";
import { PreferencesForm } from "@/components/preferences-form";
export default async function Onboarding() {
  const user = await currentUser();
  if (!user) return <AuthRequired feature="market preferences" />;
  const snapshot = await marketSnapshot();
  return (
    <div className="onboarding-workstation">
      <span className="eyebrow">Personalize your terminal</span>
      <h1>Make the market relevant.</h1>
      <PreferencesForm
        onboarding
        initialCategories={user.app.categories}
        initialInterests={user.app.interests}
        assets={snapshot.assets}
      />
    </div>
  );
}
