// E-mail versturen. Met NUXT_SMTP_URL via SMTP (bijvoorbeeld Microsoft 365, Postmark, Mailgun);
// zonder die instelling komen berichten in een uitbak in de datamap, leesbaar via Instellingen.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataPath, getConfig } from './config';
import { newId, now } from './ids';
import { log } from './log';

export interface Mail { to: string; subject: string; text: string; html: string }
export interface OutboxItem extends Mail { id: string; createdAt: string; transport: 'outbox' | 'smtp' }

type Transporter = { sendMail(m: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> };
let transporter: { url: string; t: Transporter } | null = null;

async function smtp(): Promise<Transporter | null> {
  const url = getConfig().smtpUrl;
  if (!url) return null;
  if (transporter?.url === url) return transporter.t;
  const nodemailer = await import('nodemailer');
  const t = nodemailer.createTransport(url) as unknown as Transporter;
  transporter = { url, t };
  return t;
}

export function mailMode(): 'smtp' | 'outbox' {
  return getConfig().smtpUrl ? 'smtp' : 'outbox';
}

export async function sendMail(mail: Mail): Promise<void> {
  const cfg = getConfig();
  const t = await smtp();
  const item: OutboxItem = { ...mail, id: newId(), createdAt: now(), transport: t ? 'smtp' : 'outbox' };
  if (t) {
    const from = cfg.mailFrom || `${cfg.appName} <no-reply@${new URL(cfg.appUrl).hostname}>`;
    try {
      await t.sendMail({ from, ...mail });
      log.info('mail.sent', { to: mail.to, subject: mail.subject });
    } catch (e) {
      log.error('mail.failed', { to: mail.to, subject: mail.subject, error: (e as Error).message });
      throw new Error('De e-mail kon niet worden verstuurd. Controleer de SMTP-instellingen.');
    }
    return;
  }
  await mkdir(dataPath('outbox'), { recursive: true });
  await writeFile(dataPath('outbox', `${item.createdAt.replace(/[:.]/g, '-')}-${item.id}.json`), JSON.stringify(item, null, 2));
  log.info('mail.outbox', { to: mail.to, subject: mail.subject });
}

export async function readOutbox(limit = 50): Promise<OutboxItem[]> {
  const dir = dataPath('outbox');
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, limit);
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(dir, f), 'utf8')) as OutboxItem));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Eén eenvoudig sjabloon: een alinea, een knop, en de link als tekst voor wie geen HTML ziet. */
export function actionMail(to: string, subject: string, intro: string, action: string, url: string, outro: string): Mail {
  const name = getConfig().appName;
  return {
    to,
    subject,
    text: `${intro}\n\n${action}: ${url}\n\n${outro}\n\n${name}`,
    html: `<!doctype html><html lang="nl"><body style="margin:0;background:#f6f6f5;font-family:Helvetica,Arial,sans-serif;color:#1e1f22">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #d3d3d0;border-radius:8px" cellpadding="0" cellspacing="0"><tr><td style="padding:32px">
<p style="margin:0 0 20px;font-size:15px;line-height:1.55">${esc(intro)}</p>
<p style="margin:0 0 24px"><a href="${esc(url)}" style="display:inline-block;background:#1e1f22;color:#f6f6f5;text-decoration:none;padding:12px 18px;border-radius:6px;font-size:14px">${esc(action)}</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#66686d">${esc(outro)}</p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#9b9da1;word-break:break-all">${esc(url)}</p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#9b9da1">${esc(name)}</p>
</td></tr></table></body></html>`,
  };
}
