// Lokale testscènes zonder AI. Bedoeld om de hele workflow gratis te testen; de scènes zijn
// eenvoudige tekeningen en worden in de interface duidelijk als testscène gemarkeerd.
import type { GenerateRequest, ImageProvider } from './types';
import { demoLook, renderDemoScene } from '../demo-scenes';

export function demoProvider(): ImageProvider {
  return {
    info: () => ({
      id: 'demo', label: 'Testscènes (geen AI)', model: 'demo', configured: true, problem: null,
      maxCount: 6, supportsReferences: false, isAi: false,
    }),
    async generate(req: GenerateRequest) {
      const out: Buffer[] = [];
      for (let i = 0; i < req.count; i++) {
        out.push(await renderDemoScene(req.objectType, { width: req.width, height: req.height, seed: Date.now() + i * 7919, chroma: req.surfaceMethod === 'chroma', look: demoLook(req.config) }));
      }
      return out;
    },
  };
}
