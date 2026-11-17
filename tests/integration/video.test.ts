// Scrollvideo: frames renderen en met ffmpeg tot een MP4 samenvoegen.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setConfig } from '../../server/lib/config';
import { closeDb } from '../../server/lib/db';
import { startQueue, stopQueue, waitForJob } from '../../server/lib/jobs/queue';
import { createMockup } from '../../server/lib/mockups';
import { workspaces } from '../../server/lib/repo-accounts';
import { exportsRepo, projects, scenes } from '../../server/lib/repositories';
import { seedSystemLibrary } from '../../server/lib/seed';
import { storage } from '../../server/lib/storage';
import { ingestUpload } from '../../server/lib/uploads';
import { ffmpegPath, scrollCandidate, scrollDuration, startScrollVideo } from '../../server/lib/video';

let dir = '';
let projectId = '', WS = '';
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ms-video-'));
  setConfig({ dataDir: dir, imageProvider: 'demo', billingMode: 'off' });
  WS = workspaces.create('Bureau').id;
  await seedSystemLibrary();
  projectId = projects.create({ workspaceId: WS, name: 'Video', client: '', url: '' }).id;
  startQueue(100);
});
afterAll(() => { stopQueue(); closeDb(); rmSync(dir, { recursive: true, force: true }); });

/** Een lange 'website' met horizontale banden, zodat scrollen zichtbaar is. */
async function tallPage() {
  const w = 720, h = 2600;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${Array.from({ length: 13 }, (_, i) => `<rect y="${i * 200}" width="${w}" height="200" fill="${i % 2 ? '#1e1f22' : '#e8e4dc'}"/>`).join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('scrollvideo', () => {
  it('vindt ffmpeg', () => { expect(ffmpegPath()).toBeTruthy(); });

  it('weigert een mockup waarin niets te scrollen is', async () => {
    const [logo] = await ingestUpload({ projectId, workspaceId: WS, kind: 'design', filename: 'logo.png', buffer: await sharp({ create: { width: 400, height: 200, channels: 3, background: '#333' } }).png().toBuffer() });
    const laptop = scenes.list({ library: true }).find((s) => s.objectType === 'laptop')!;
    const m = createMockup({ projectId, sceneId: laptop.id, assetId: logo!.id });
    expect(scrollCandidate(m.id)).toBeNull();
    expect(() => startScrollVideo(m.id, 1280)).toThrow(/niets om te scrollen/);
  });

  it('maakt een MP4 waarin de pagina van boven naar onder scrolt', async () => {
    const [page] = await ingestUpload({ projectId, workspaceId: WS, kind: 'design', filename: 'site.png', buffer: await tallPage() });
    const phone = scenes.list({ library: true }).find((s) => s.objectType === 'smartphone')!;
    const m = createMockup({ projectId, sceneId: phone.id, assetId: page!.id });
    const c = scrollCandidate(m.id)!;
    expect(c.range).toBeGreaterThan(0.3);
    expect(scrollDuration(c.range)).toBeGreaterThanOrEqual(6);
    const { jobId, exportId } = startScrollVideo(m.id, 1280);
    const job = await waitForJob(jobId, 280_000);
    expect(job.error, String(job.error)).toBeNull();
    expect(job.status).toBe('done');
    const e = exportsRepo.get(exportId)!;
    expect(e.format).toBe('mp4');
    expect(e.width % 2).toBe(0);
    expect(e.height % 2).toBe(0);
    const bytes = await storage.read(e.file);
    expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(bytes.length).toBeGreaterThan(20_000);
    void readFileSync;
  }, 300_000);
});
