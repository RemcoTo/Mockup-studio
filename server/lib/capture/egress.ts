// Egress-proxy voor de browser van de website-import. Chromium gaat voor elk verzoek (pagina, beelden,
// scripts, redirects) via deze proxy op 127.0.0.1. De proxy zoekt zelf het adres op, controleert dat
// het publiek is en een toegestane poort heeft, en verbindt met precies dat adres. Zo kan een
// DNS-antwoord dat verandert (rebinding) de browser nooit naar een intern adres sturen.
import http from 'node:http';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { log } from '../log';
import { isAllowedPort, resolvePublic } from './ssrf';

let server: http.Server | null = null;
let info: { server: string; username: string; password: string } | null = null;

const HOP = ['proxy-authorization', 'proxy-connection', 'connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

function authorized(req: http.IncomingMessage) {
  const h = req.headers['proxy-authorization'];
  return !!info && h === `Basic ${Buffer.from(`${info.username}:${info.password}`).toString('base64')}`;
}

export async function egressProxy() {
  if (info) return info;
  const password = randomBytes(18).toString('base64url');
  server = http.createServer(async (req, res) => {
    // Gewone http-verzoeken komen met een absolute URL binnen.
    try {
      if (!authorized(req)) { res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="egress"' }).end(); return; }
      const url = new URL(req.url ?? '');
      if (url.protocol !== 'http:' || !isAllowedPort(url.port)) { res.writeHead(403).end(); return; }
      const [ip] = await resolvePublic(url.hostname);
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !HOP.includes(k)));
      const up = http.request({ host: ip, port: url.port || 80, method: req.method, path: url.pathname + url.search, headers: { ...headers, host: url.host }, timeout: 30_000 }, (r) => {
        res.writeHead(r.statusCode ?? 502, Object.fromEntries(Object.entries(r.headers).filter(([k]) => !HOP.includes(k))) as http.OutgoingHttpHeaders);
        r.pipe(res);
      });
      up.on('timeout', () => up.destroy());
      up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(up);
    } catch {
      if (!res.headersSent) res.writeHead(403);
      res.end();
    }
  });
  // https via CONNECT host:poort.
  server.on('connect', async (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    socket.on('error', () => {});
    try {
      if (!authorized(req)) { socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="egress"\r\n\r\n'); return; }
      const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url ?? '');
      if (!m || !isAllowedPort(m[2]!)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
      const [ip] = await resolvePublic(m[1]!);
      const up = net.connect(Number(m[2]), ip!, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) up.write(head);
        up.pipe(socket);
        socket.pipe(up);
      });
      up.setTimeout(60_000, () => up.destroy());
      up.on('error', () => socket.destroy());
      socket.on('close', () => up.destroy());
    } catch {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  server.unref();
  const port = (server.address() as net.AddressInfo).port;
  info = { server: `http://127.0.0.1:${port}`, username: 'capture', password };
  log.info('capture.egress_proxy', { port });
  return info;
}

export async function closeEgressProxy() {
  const s = server;
  server = null; info = null;
  await new Promise<void>((r) => (s ? s.close(() => r()) : r()));
}
