// Abonnementen en creditpakketten. Dit is een VOORSTEL: de bedragen en limieten zijn een zakelijke
// beslissing en staan hier op één plek, zodat ze zonder codewijziging elders aan te passen zijn.
// Rekenbasis (gpt-image-2, gepubliceerde prijzen): één credit kost ons ongeveer $0,0083 aan AI.
// Credits vervallen nooit; een mislukte generatie kost niets.

export type PlanId = 'free' | 'studio' | 'team';
export type Feature = 'tiff' | 'video' | 'shares' | 'versions' | 'living' | 'brandShoot' | 'teamInvites';

export interface Plan {
  id: PlanId;
  name: string;
  /** Prijs per maand in euro, exclusief btw. */
  monthlyEur: number;
  /** Lookup key van de prijs in Stripe (zie scripts/stripe-setup.mjs). */
  lookupKey: string | null;
  tagline: string;
  seats: number;
  /** null = onbeperkt. */
  projects: number | null;
  /** Credits die elke betaalde maand worden bijgeschreven. */
  monthlyCredits: number;
  /** Eenmalige welkomstcredits bij het aanmaken van een werkruimte. */
  welcomeCredits: number;
  /** Langste zijde van een export in pixels; null = de volledige resolutie van de scène. */
  maxExportEdge: number | null;
  /** Gelijktijdig actieve klantpresentaties; null = onbeperkt. */
  activeShares: number | null;
  features: Feature[];
  highlights: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free', name: 'Gratis', monthlyEur: 0, lookupKey: null, tagline: 'Om de studio te leren kennen.',
    seats: 1, projects: 3, monthlyCredits: 0, welcomeCredits: 30, maxExportEdge: 2000, activeShares: 1,
    features: ['shares', 'versions'],
    highlights: ['30 credits om AI-scènes te proberen', 'Onbeperkt bibliotheekmockups', 'Export tot 2000 px, zonder watermerk', '3 projecten, 1 klantpresentatie'],
  },
  studio: {
    id: 'studio', name: 'Studio', monthlyEur: 19, lookupKey: 'studio_monthly', tagline: 'Voor zelfstandig ontwerpers.',
    seats: 1, projects: null, monthlyCredits: 300, welcomeCredits: 0, maxExportEdge: null, activeShares: null,
    features: ['tiff', 'video', 'shares', 'versions', 'living', 'brandShoot'],
    highlights: ['300 credits per maand, vervallen niet', 'Onbeperkt projecten en presentaties', 'TIFF voor druk, scrollvideo, brand shoot', 'Levende websitemockups'],
  },
  team: {
    id: 'team', name: 'Team', monthlyEur: 59, lookupKey: 'team_monthly', tagline: 'Voor bureaus en merkteams.',
    seats: 5, projects: null, monthlyCredits: 1200, welcomeCredits: 0, maxExportEdge: null, activeShares: null,
    features: ['tiff', 'video', 'shares', 'versions', 'living', 'brandShoot', 'teamInvites'],
    highlights: ['1200 credits per maand, gedeeld in het team', 'Tot 5 teamleden met rollen', 'Alles uit Studio', 'Voorrang bij ondersteuning'],
  },
};

export interface TopUp { id: string; credits: number; priceEur: number; lookupKey: string }
export const TOPUPS: TopUp[] = [
  { id: 'credits_250', credits: 250, priceEur: 9, lookupKey: 'credits_250' },
  { id: 'credits_1000', credits: 1000, priceEur: 29, lookupKey: 'credits_1000' },
];

export const FEATURE_LABELS: Record<Feature, string> = {
  tiff: 'TIFF voor druk', video: 'Scrollvideo', shares: 'Klantpresentaties', versions: 'Ontwerpversies',
  living: 'Automatisch bijwerken van websites', brandShoot: 'Brand shoot', teamInvites: 'Teamleden uitnodigen',
};

export const planById = (id: string | null | undefined): Plan => PLANS[(id as PlanId) in PLANS ? (id as PlanId) : 'free'];
export const planByLookupKey = (key: string | null | undefined): Plan | null => Object.values(PLANS).find((p) => p.lookupKey === key) ?? null;
