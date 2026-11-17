import { describe, expect, it } from 'vitest';
import { assertPublicHost, isPrivateAddress, normalizeUrl } from '../../server/lib/capture/ssrf';

describe('SSRF-bescherming', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', 'ff02::1',
  ])('blokkeert intern adres %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8'])('laat publiek adres %s toe', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false));

  it('weigert andere protocollen, inloggegevens en vreemde poorten', () => {
    expect(() => normalizeUrl('file:///etc/passwd')).toThrow(/http/);
    expect(() => normalizeUrl('javascript:alert(1)')).toThrow();
    expect(() => normalizeUrl('https://user:pw@voorbeeld.nl')).toThrow(/wachtwoord/);
    expect(() => normalizeUrl('https://voorbeeld.nl:22')).toThrow(/poorten/);
    expect(normalizeUrl('voorbeeld.nl/pagina').href).toBe('https://voorbeeld.nl/pagina');
  });

  it('weigert localhost, metadata en IP-letterlijken in het interne bereik', async () => {
    await expect(assertPublicHost('localhost')).rejects.toThrow(/intern/);
    await expect(assertPublicHost('169.254.169.254')).rejects.toThrow(/intern/);
    await expect(assertPublicHost('[::1]')).rejects.toThrow(/intern/);
    await expect(assertPublicHost('metadata.google.internal')).rejects.toThrow(/intern/);
  });
});

import http from 'node:http';
import net from 'node:net';
import { setConfig } from '../../server/lib/config';
import { closeEgressProxy, egressProxy } from '../../server/lib/capture/egress';

function viaProxy(proxy: { server: string; username: string; password: string }, opts: { connect?: string; url?: string; auth?: boolean }) {
  const { port } = new URL(proxy.server);
  const auth = opts.auth === false ? '' : `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}\r\n`;
  return new Promise<string>((resolve) => {
    const s = net.connect(Number(port), '127.0.0.1', () => {
      if (opts.connect) s.write(`CONNECT ${opts.connect} HTTP/1.1\r\nHost: ${opts.connect}\r\n${auth}\r\n`);
      else s.write(`GET ${opts.url} HTTP/1.1\r\nHost: ${new URL(opts.url!).host}\r\n${auth}Connection: close\r\n\r\n`);
    });
    let buf = '';
    s.on('data', (d) => { buf += d; if (buf.includes('\r\n')) { resolve(buf.split('\r\n')[0]!); s.destroy(); } });
    s.on('error', () => resolve(buf));
  });
}

describe('egress-proxy van de browser', () => {
  it('verbindt alleen met publieke adressen op toegestane poorten, en alleen met wachtwoord', async () => {
    setConfig({ captureAllowPrivate: false });
    const site = http.createServer((_, res) => res.end('intern geheim'));
    await new Promise<void>((r) => site.listen(8080, '127.0.0.1', r));
    try {
      const p = await egressProxy();
      expect(await viaProxy(p, { url: 'http://127.0.0.1:8080/', auth: false })).toMatch(/407/);
      expect(await viaProxy(p, { url: 'http://127.0.0.1:8080/' })).toMatch(/403/);
      expect(await viaProxy(p, { connect: '169.254.169.254:443' })).toMatch(/403/);
      expect(await viaProxy(p, { connect: '8.8.8.8:22' })).toMatch(/403/);
      // Alleen voor lokale tests: interne adressen toegestaan.
      setConfig({ captureAllowPrivate: true });
      expect(await viaProxy(p, { url: 'http://127.0.0.1:8080/' })).toMatch(/200/);
    } finally {
      setConfig({ captureAllowPrivate: false });
      await closeEgressProxy();
      site.close();
    }
  });
});
