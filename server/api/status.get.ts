import { existsSync } from 'node:fs';
import { PRICE_SOURCE, PRICE_TABLE, CREDITS_PER_IMAGE } from '../../shared/pricing';
import { creditsEnforced } from '../lib/billing/credits';
import { getConfig } from '../lib/config';
import { getProvider, listProviders } from '../lib/generation/providers';
import { mailMode } from '../lib/mail';

import { apiHandler } from '../lib/http/api';
import { requireUser } from '../lib/http/auth';
export default apiHandler(async (event) => {
  const ctx = requireUser(event);
  const c = getConfig();
  let browser: { installed: boolean } = { installed: false };
  try {
    const { chromium } = await import('playwright-core');
    const p = c.chromiumPath || chromium.executablePath();
    browser = { installed: !!p && existsSync(p) };
  } catch {
    browser = { installed: false };
  }
  return {
    provider: getProvider().info(),
    providers: ctx.user.isAdmin ? listProviders() : [],
    browser,
    uploadMaxMb: c.uploadMaxMb,
    captureAllowPrivate: c.captureAllowPrivate,
    pricing: { source: PRICE_SOURCE, table: PRICE_TABLE, credits: CREDITS_PER_IMAGE },
    mailMode: mailMode(),
    creditsEnforced: creditsEnforced(),
    limits: { aiDailyUsd: c.aiDailyLimitUsd, aiWorkspaceDailyUsd: c.aiWorkspaceDailyLimitUsd },
  };
});
