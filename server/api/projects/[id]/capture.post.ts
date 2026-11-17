import { z } from 'zod';
import { captureWebsite } from '../../../lib/capture/capture';
import { rateLimit } from '../../../lib/ratelimit';
import { projects } from '../../../lib/repositories';
import { ingestUpload } from '../../../lib/uploads';
import { parse } from '../../../lib/validation';

import { apiHandler, param } from '../../../lib/http/api';
import { requireProject } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
const schema = z.object({
  url: z.string().trim().min(1).max(2000),
  viewport: z.enum(['desktop', 'laptop', 'tablet', 'smartphone']),
  fullPage: z.boolean().default(false),
  hideCookieBanners: z.boolean().default(true),
  delayMs: z.number().int().min(0).max(10000).optional(),
});

export default apiHandler(async (event) => {
  const { project, ctx } = requireProject(event, param(event), 'member');
  rateLimit(`capture:${ctx.workspace.id}`, 60, 3600_000, 'Je hebt in korte tijd veel websites vastgelegd.');
  const body = parse(schema, await readBody(event));
  const shot = await captureWebsite(body);
  const host = new URL(shot.finalUrl).hostname.replace(/^www\./, '');
  const name = `${host} ${body.viewport}${body.fullPage ? ' volledig' : ''}.png`;
  const [asset] = await ingestUpload({
    projectId: project.id, workspaceId: ctx.workspace.id, kind: 'design', filename: name, buffer: shot.png, source: 'url',
    meta: { url: body.url, finalUrl: shot.finalUrl, title: shot.title, viewport: body.viewport, fullPage: body.fullPage, hideCookieBanners: body.hideCookieBanners, delayMs: body.delayMs, capturedAt: new Date().toISOString(), warnings: shot.warnings },
  });
  if (!project.url) projects.update(project.id, { url: shot.finalUrl });
  return { asset: present.asset(asset!), warnings: shot.warnings };
});
