import { getConfig } from '../../config';
import { demoProvider } from './demo';
import { openAIProvider } from './openai';
import type { ImageProvider } from './types';

const registry: Record<string, () => ImageProvider> = {
  openai: openAIProvider,
  demo: demoProvider,
};

export function getProvider(id?: string): ImageProvider {
  const key = id || getConfig().imageProvider;
  const make = registry[key];
  if (!make) throw new Error(`Onbekende beeldprovider: ${key}. Kies uit: ${Object.keys(registry).join(', ')}.`);
  return make();
}

export function listProviders() {
  return Object.keys(registry).map((k) => registry[k]!().info());
}
