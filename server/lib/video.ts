// Scrollvideo: een lange websitescreenshot scrolt rustig door het scherm van een apparaat in de scène.
// De frames worden in de rekenpool gerenderd (verdeeld over workers) en met ffmpeg tot een MP4 (H.264)
// samengevoegd. ffmpeg komt uit het pakket ffmpeg-static, of uit NUXT_FFMPEG_PATH / het systeem.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError, badRequest, notFound } from './errors';
import { newId, now } from './ids';
import { runTask } from './imaging/pool';
import { scrollRange } from './imaging/tasks';
import { placementSurface } from './imaging/composite';
import { enqueue, getJob, registerJob, type Job } from './jobs/queue';
import { keys } from './keys';
import { log } from './log';
import { renderSpec } from './mockups';
import { assets, exportsRepo, mockups, projects, scenes } from './repositories';
import { storage, tempDir } from './storage';
import { assertFeature } from './billing/plans';
import { resolveGeometry } from '../../shared/warp';

export const VIDEO_WIDTHS = [1280, 1920] as const;
const FPS = 30;
const HOLD = 0.8;

export function ffmpegPath(): string | null {
  if (process.env.NUXT_FFMPEG_PATH && existsSync(process.env.NUXT_FFMPEG_PATH)) return process.env.NUXT_FFMPEG_PATH;
  try {
    const p = createRequire(import.meta.url)('ffmpeg-static') as string | null;
    if (p && existsSync(p)) return p;
  } catch { /* niet geïnstalleerd */ }
  for (const p of ['/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg']) if (existsSync(p)) return p;
  return null;
}

/** Welke plaatsing kan scrollen: een scherm met een ontwerp dat langer is dan het scherm. */
export function scrollCandidate(mockupId: string) {
  const m = mockups.get(mockupId);
  if (!m) throw notFound('Mockup');
  const scene = scenes.get(m.sceneId)!;
  let best: { index: number; range: number } | null = null;
  m.placements.forEach((p, index) => {
    // Een mailscherm scrolt niet: de mailweergave vult het scherm al.
    if (p.hidden || !p.assetId || p.layout) return;
    const a = assets.get(p.assetId);
    const surface = scene.surfaces.find((s) => s.id === p.surfaceId);
    if (!a || !surface) return;
    const geo = resolveGeometry(surface, p);
    const { surface: dims } = placementSurface(geo.quad, geo.mesh, geo.cylinder, { width: scene.width, height: scene.height, aspect: geo.aspect });
    const range = scrollRange(a, dims, p.transform.scale);
    if (range > 0.05 && (!best || range > best.range)) best = { index, range };
  });
  return best as { index: number; range: number } | null;
}

/** Duur: rustig tempo van ongeveer anderhalve schermhoogte per seconde, tussen 6 en 24 seconden. */
export const scrollDuration = (range: number) => Math.min(24, Math.max(6, 2 * HOLD + range / 0.65));

export function startScrollVideo(mockupId: string, width: number) {
  if (!VIDEO_WIDTHS.includes(width as never)) throw badRequest('Kies 1280 of 1920 pixels breed.');
  const owner = mockups.get(mockupId);
  if (owner) assertFeature(projects.get(owner.projectId)!.workspaceId, 'video');
  const c = scrollCandidate(mockupId);
  if (!c) throw badRequest('Er is niets om te scrollen. Gebruik een volledige websitescreenshot (hoger dan het scherm) op een scherm in deze mockup.');
  if (!ffmpegPath()) throw new AppError(503, 'ffmpeg is niet gevonden. Installeer de afhankelijkheden opnieuw (npm install) of stel NUXT_FFMPEG_PATH in.', 'ffmpeg_missing');
  const m = mockups.get(mockupId)!;
  const exportId = newId();
  const jobId = enqueue('scroll-video', { mockupId, exportId, width, index: c.index }, { workspaceId: projects.get(m.projectId)!.workspaceId, ref: mockupId, maxAttempts: 1 });
  return { jobId, exportId, duration: scrollDuration(c.range) };
}

function encode(framesDir: string, out: string) {
  return new Promise<void>((resolve, reject) => {
    const args = ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(framesDir, 'frame-%05d.jpg'),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out];
    const p = spawn(ffmpegPath()!, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg stopte met code ${code}: ${err.slice(0, 400)}`))));
  });
}

async function runScrollVideo(job: Job<{ mockupId: string; exportId: string; width: number; index: number }>) {
  const m = mockups.get(job.payload.mockupId);
  if (!m) return;
  const scene = scenes.get(m.sceneId)!;
  const c = scrollCandidate(m.id);
  if (!c) throw new Error('Er is niets meer om te scrollen in deze mockup.');
  const duration = scrollDuration(c.range);
  const spec = await renderSpec(m, scene, { width: job.payload.width, supersample: 2, output: { format: 'jpg', quality: 92 } });
  // renderSpec slaat verborgen plaatsingen over; zoek de juiste index in de gerenderde lijst.
  const visible = m.placements.map((p, i) => ({ p, i })).filter(({ p }) => !p.hidden && scene.surfaces.some((s) => s.id === p.surfaceId));
  const animate = visible.findIndex(({ i }) => i === c.index);
  const tmp = await tempDir();
  try {
    const framesDir = path.join(tmp.dir, 'frames');
    const total = Math.round(duration * FPS);
    const chunk = Math.ceil(total / 4);
    const parts = await Promise.all([0, 1, 2, 3].map((k) => runTask('renderScrollFrames', {
      render: spec, animate, outDir: framesDir, fps: FPS, duration, hold: HOLD, from: k * chunk, to: (k + 1) * chunk,
    })));
    const written = (await readdir(framesDir)).filter((f) => f.endsWith('.jpg')).length;
    if (written !== total) throw new Error(`Er zijn ${written} van de ${total} frames gemaakt.`);
    const out = path.join(tmp.dir, 'video.mp4');
    await encode(framesDir, out);
    const key = `${keys.exports(projects.get(m.projectId)!.workspaceId, m.projectId)}/${job.payload.exportId}.mp4`;
    const bytes = (await stat(out)).size;
    await storage.putFile(key, out);
    exportsRepo.insert({ id: job.payload.exportId, mockupId: m.id, projectId: m.projectId, format: 'mp4', quality: 20, file: key, width: parts[0]!.width, height: parts[0]!.height, createdAt: now() });
    log.info('video.done', { mockup: m.id, seconds: duration, bytes });
  } finally {
    await tmp.cleanup();
  }
}

registerJob('scroll-video', { concurrency: 1, timeoutMs: 8 * 60_000, run: runScrollVideo as never });

export function videoStatus(jobId: string, mockupId: string) {
  const j = getJob(jobId);
  if (!j || j.type !== 'scroll-video' || j.ref !== mockupId) throw notFound('Video');
  const exportId = (j.payload as { exportId: string }).exportId;
  return { status: j.status, error: j.status === 'failed' ? (j.error ?? 'Het maken van de video is mislukt.') : null, export: j.status === 'done' ? exportsRepo.get(exportId) : null };
}
