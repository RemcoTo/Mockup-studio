// Eén plek voor instellingen. In Nitro vult de startup-plugin dit vanuit runtimeConfig;
// in tests en scripts komt alles uit de omgevingsvariabelen.
import path from 'node:path';

export interface AppConfig {
  dataDir: string;
  imageProvider: string;
  openaiApiKey: string;
  openaiImageModel: string;
  openaiBaseUrl: string;
  chromiumPath: string;
  captureMaxConcurrency: number;
  captureAllowPrivate: boolean;
  uploadMaxMb: number;
  appUrl: string;
  appName: string;
  mailFrom: string;
  smtpUrl: string;
  allowSignup: boolean;
  /** E-mailbevestiging verplicht voor AI-scènes en uitnodigen. Uit (standaard) voor gebruik op je eigen computer. */
  requireEmailVerification: boolean;
  /** off = geen credits afschrijven (eigen installatie), credits = credits verplicht. */
  billingMode: 'off' | 'credits';
  aiDailyLimitUsd: number;
  aiWorkspaceDailyLimitUsd: number;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
}

const env = process.env;
let config: AppConfig = {
  dataDir: env.NUXT_DATA_DIR || './data',
  imageProvider: env.NUXT_IMAGE_PROVIDER || 'demo',
  openaiApiKey: env.NUXT_OPENAI_API_KEY || '',
  openaiImageModel: env.NUXT_OPENAI_IMAGE_MODEL || 'gpt-image-2',
  openaiBaseUrl: env.NUXT_OPENAI_BASE_URL || 'https://api.openai.com/v1',
  chromiumPath: env.NUXT_CHROMIUM_PATH || '',
  captureMaxConcurrency: Number(env.NUXT_CAPTURE_MAX_CONCURRENCY || 2),
  captureAllowPrivate: env.NUXT_CAPTURE_ALLOW_PRIVATE === 'true',
  uploadMaxMb: Number(env.NUXT_UPLOAD_MAX_MB || 40),
  appUrl: (env.NUXT_APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  appName: env.NUXT_APP_NAME || 'Mockup Studio',
  mailFrom: env.NUXT_MAIL_FROM || '',
  smtpUrl: env.NUXT_SMTP_URL || '',
  allowSignup: env.NUXT_ALLOW_SIGNUP !== 'false',
  requireEmailVerification: env.NUXT_REQUIRE_EMAIL_VERIFICATION === 'true',
  billingMode: env.NUXT_BILLING_MODE === 'credits' ? 'credits' : 'off',
  aiDailyLimitUsd: Number(env.NUXT_AI_DAILY_LIMIT_USD || 25),
  aiWorkspaceDailyLimitUsd: Number(env.NUXT_AI_WORKSPACE_DAILY_LIMIT_USD || 5),
  stripeSecretKey: env.NUXT_STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.NUXT_STRIPE_WEBHOOK_SECRET || '',
};

export function setConfig(partial: Partial<AppConfig>) {
  const clean = Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined && v !== '')) as Partial<AppConfig>;
  config = { ...config, ...clean };
  if (typeof partial.captureAllowPrivate === 'boolean') config.captureAllowPrivate = partial.captureAllowPrivate;
  if (typeof partial.allowSignup === 'boolean') config.allowSignup = partial.allowSignup;
  if (typeof partial.requireEmailVerification === 'boolean') config.requireEmailVerification = partial.requireEmailVerification;
  config.appUrl = config.appUrl.replace(/\/$/, '');
}

export function getConfig(): AppConfig {
  return config;
}

export function dataPath(...parts: string[]) {
  return path.resolve(config.dataDir, ...parts);
}
