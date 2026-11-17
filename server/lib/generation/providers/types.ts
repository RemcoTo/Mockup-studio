import type { SceneConfig } from '../../../../shared/types';
export interface GenerateRequest {
  prompt: string;
  width: number;
  height: number;
  quality: 'low' | 'medium' | 'high';
  count: number;
  /** Referentiebeelden als PNG of JPEG. */
  references: { data: Buffer; mime: string; name: string }[];
  /** Voor de demoprovider: welk object getoond moet worden. */
  objectType: string;
  surfaceMethod: 'chroma' | 'blank';
  /** Volledige configuratie; alleen de testscènes gebruiken hem (kleuren, platte achtergrond). */
  config?: SceneConfig;
  signal?: AbortSignal;
}

export interface ProviderInfo {
  id: string;
  label: string;
  model: string;
  configured: boolean;
  /** Uitleg als de provider niet bruikbaar is, in gewone taal. */
  problem: string | null;
  maxCount: number;
  supportsReferences: boolean;
  /** Echte AI-generatie of lokale testscènes. */
  isAi: boolean;
}

export interface ImageProvider {
  info(): ProviderInfo;
  generate(req: GenerateRequest): Promise<Buffer[]>;
}
