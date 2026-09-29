import { currentUser } from "@/lib/product/auth";
import { marketSnapshot } from "@/lib/product/market";
import { AuthRequired } from "@/components/auth-required";
import { PreferencesForm } from "@/components/preferences-form";
import { PRIVATE_ROBOTS } from "@/lib/seo";
import { SignupCompleted } from "@/components/signup-completed";
export const metadata = {
  title: "Onboarding",
  description: "Set up your FloatAlpha account.",
  robots: PRIVATE_ROBOTS,
};
export default async function Onboarding() {
  const user = await currentUser();
  if (!user) return <AuthRequired feature="market preferences" />;
  const snapshot = await marketSnapshot();
  return (
    <div className="onboarding-workstation">
      {/*
        Signup completion. This page is the post-signup destination for both
        the Google callback and the email verification link, and is not linked
        from navigation, so it is reached essentially once per account. The
        component decides whether this is that first load.
      */}
      <SignupCompleted
        profileId={user.app.id}
        profileCreatedAt={user.app.createdAt}
        verified={Boolean(user.identity.emailVerified)}
      />
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
