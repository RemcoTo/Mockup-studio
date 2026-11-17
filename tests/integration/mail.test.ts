// E-mail via SMTP, tegen een lokale testserver (smtp-server).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setConfig } from '../../server/lib/config';
import { actionMail, sendMail } from '../../server/lib/mail';

let dir = '';
const received: { from: string; to: string[]; data: string }[] = [];
let server: SMTPServer;
let port = 0;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ms-mail-'));
  server = new SMTPServer({
    authOptional: false, secure: false, disabledCommands: ['STARTTLS'],
    onAuth(auth, _s, cb) { cb(auth.username === 'studio' && auth.password === 'geheim' ? null : new Error('Onjuist'), { user: auth.username }); },
    onData(stream, session, cb) {
      let data = '';
      stream.on('data', (c) => { data += c; });
      stream.on('end', () => { received.push({ from: session.envelope.mailFrom ? (session.envelope.mailFrom as { address: string }).address : '', to: session.envelope.rcptTo.map((r) => r.address), data }); cb(); });
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.server.address() as { port: number }).port;
  setConfig({ dataDir: dir, appUrl: 'https://studio.example', mailFrom: 'Mockup Studio <studio@studio.example>' });
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); rmSync(dir, { recursive: true, force: true }); });

describe('e-mail via SMTP', () => {
  it('verstuurt een bericht met tekst, HTML en de juiste afzender', async () => {
    setConfig({ smtpUrl: `smtp://studio:geheim@127.0.0.1:${port}?ignoreTLS=true` });
    await sendMail(actionMail('klant@voorbeeld.nl', 'Je uitnodiging', 'Hallo, je bent uitgenodigd.', 'Bekijken', 'https://studio.example/x', 'Groet'));
    expect(received).toHaveLength(1);
    expect(received[0]!.from).toBe('studio@studio.example');
    expect(received[0]!.to).toEqual(['klant@voorbeeld.nl']);
    expect(received[0]!.data).toMatch(/Subject: Je uitnodiging/);
    expect(received[0]!.data).toMatch(/text\/html/);
  });
  it('geeft een duidelijke fout als inloggen bij de mailserver mislukt', async () => {
    setConfig({ smtpUrl: `smtp://studio:fout@127.0.0.1:${port}?ignoreTLS=true` });
    await expect(sendMail(actionMail('a@b.nl', 'x', 'y', 'z', 'https://a', 'b'))).rejects.toThrow(/SMTP-instellingen/);
  });
});
