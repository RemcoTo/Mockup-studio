// Standaard staat e-mailbevestiging uit: direct na registreren kan een account alles, zonder e-mail en zonder SMTP.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invite, login, signup } from '../../server/lib/auth/accounts';
import { isVerified, verificationRequired } from '../../server/lib/auth/verification';
import { getConfig, setConfig } from '../../server/lib/config';
import { closeDb } from '../../server/lib/db';
import { startGeneration, waitForGeneration } from '../../server/lib/generation/jobs';
import { startQueue, stopQueue } from '../../server/lib/jobs/queue';
import { readOutbox } from '../../server/lib/mail';
import { generations, projects } from '../../server/lib/repositories';
import { seedSystemLibrary } from '../../server/lib/seed';

let dir = '';
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ms-noverify-'));
  setConfig({ dataDir: dir, imageProvider: 'demo', billingMode: 'off', allowSignup: true, requireEmailVerification: false });
  await seedSystemLibrary();
  startQueue(100);
});
afterAll(() => { stopQueue(); closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe('zonder e-mailbevestiging (standaard)', () => {
  it('staat standaard uit en heeft geen SMTP nodig', () => {
    expect(verificationRequired()).toBe(false);
    expect(getConfig().smtpUrl).toBe('');
  });

  it('verstuurt bij registratie geen bevestigingsmail en het account mag direct alles', async () => {
    const { user, workspace } = await signup({ email: 'lokaal@studio.test', name: 'Lokaal', password: 'paarse olifant op de fiets' });
    expect(user.emailVerifiedAt).toBeNull();
    expect(isVerified(user)).toBe(true);
    expect((await readOutbox()).filter((m) => m.subject.startsWith('Bevestig'))).toHaveLength(0);
    // Inloggen werkt gewoon.
    await expect(login('lokaal@studio.test', 'paarse olifant op de fiets')).resolves.toBeTruthy();
    // Direct een scène genereren (testprovider).
    const p = projects.create({ workspaceId: workspace.id, name: 'Meteen aan de slag', client: '', url: '' });
    const g = startGeneration({ projectId: p.id, assetId: null, count: 1, userId: user.id, config: { category: 'devices', objectType: 'laptop', aspect: '3:2', resolution: 'standard', quality: 'low', surfaceMethod: 'chroma' } });
    await waitForGeneration(g.id);
    expect(generations.get(g.id)!.status).toBe('done');
    // Ook met een AI-provider geldt geen bevestigingseis (onbereikbaar adres: er wordt niets aangeroepen of betaald).
    setConfig({ imageProvider: 'openai', openaiApiKey: 'sk-test-niet-echt', openaiBaseUrl: 'http://127.0.0.1:9/v1' });
    try {
      const ai = startGeneration({ projectId: p.id, assetId: null, count: 1, userId: user.id, config: { category: 'devices', objectType: 'laptop', aspect: '3:2', resolution: 'standard', quality: 'low', surfaceMethod: 'chroma' } });
      expect(ai.status).toBe('queued');
      await waitForGeneration(ai.id);
    } finally {
      setConfig({ imageProvider: 'demo', openaiBaseUrl: 'https://api.openai.com/v1' });
    }
    // Uitnodigen is ook toegestaan (de uitnodiging komt in de uitbak als er geen SMTP is).
    await expect(invite(workspace, 'collega@studio.test', 'member', user)).resolves.toBeTruthy();
  });

  it('dwingt bevestiging weer af als het wordt aangezet', async () => {
    setConfig({ requireEmailVerification: true });
    try {
      const { user } = await signup({ email: 'openbaar@studio.test', name: 'Openbaar', password: 'paarse olifant op de fiets' });
      expect(isVerified(user)).toBe(false);
      expect((await readOutbox()).some((m) => m.to === 'openbaar@studio.test' && m.subject.startsWith('Bevestig'))).toBe(true);
    } finally {
      setConfig({ requireEmailVerification: false });
    }
  });
});
