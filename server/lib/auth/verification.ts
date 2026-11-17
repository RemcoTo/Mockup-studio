// E-mailbevestiging is een instelling. Uit (standaard): een account kan direct alles, er wordt geen
// bevestigingsmail verstuurd en er is geen SMTP nodig. Aan (NUXT_REQUIRE_EMAIL_VERIFICATION=true, voor een
// openbare server): AI-scènes en uitnodigen pas na een bevestigd e-mailadres.
import { getConfig } from '../config';
import type { User } from '../repo-accounts';

export const verificationRequired = () => getConfig().requireEmailVerification;

/** Voldoet dit account aan de bevestigingseis? Zonder eis altijd ja. */
export const isVerified = (user: Pick<User, 'emailVerifiedAt'>) => !verificationRequired() || !!user.emailVerifiedAt;
