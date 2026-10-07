import { cookies } from "next/headers";
import { currentUser } from "@/lib/product/auth";
import { claimSignupConversion } from "@/lib/product/signup-conversion";
import {
  ACQUISITION_COOKIE,
  conversionCampaign,
  parseAcquisition,
} from "@/lib/acquisition";
import { SignupConversionEmitter } from "./signup-conversion-emitter";

/**
 * Reports a completed signup, once per account.
 *
 * Rendered from the shells a newly created account can land on. Which one wins
 * does not matter: the claim is a conditional UPDATE in the database, so the
 * first render to reach it takes the report and every other render — on any
 * page, tab or device — gets nothing. That is what makes the `returnTo`
 * destinations safe without emitting from each of them.
 *
 * Costs nothing for an established account: the claim is skipped in memory when
 * the profile is older than the conversion window, so no write is attempted on
 * ordinary page views.
 */
export async function SignupConversion() {
  const user = await currentUser();
  // An authenticated session IS the proof the account is usable — for Google,
  // email and Steam alike. See signup-conversion.ts for why this replaced the
  // old emailVerified test.
  if (!user) return null;

  const conversion = await claimSignupConversion({
    appUserId: user.app.id,
    createdAt: user.app.createdAt,
    signupMethod: user.app.signupMethod,
  });
  if (!conversion) return null;

  const acquisition = parseAcquisition(
    (await cookies()).get(ACQUISITION_COOKIE)?.value,
  );
  return (
    <SignupConversionEmitter
      method={conversion.method}
      campaign={conversionCampaign(acquisition)}
    />
  );
}
