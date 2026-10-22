import http from 'node:http';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function equal(a, b) {
  const x = Buffer.from(a ?? ''), y = Buffer.from(b ?? '');
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createReceiver(config) {
  for (const name of ['appSecret', 'verifyToken', 'inboxToken', 'phoneNumberId']) {
    if (!config[name]) throw new Error(`Missing required configuration: ${name}`);
  }
  if (config.inboxToken.length < 32 || config.verifyToken.length < 32) {
    throw new Error('Use random tokens of at least 32 characters.');
  }
  const retention = Number(config.retentionDays ?? 30);
  if (!Number.isInteger(retention) || retention < 1 || retention > 365) throw new Error('Invalid retentionDays');
  const path = config.dbPath ?? './data/events.sqlite';
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, event_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL, received_at TEXT NOT NULL, payload TEXT NOT NULL
    );`);
  const insert = db.prepare('INSERT OR IGNORE INTO events(event_key,kind,received_at,payload) VALUES(?,?,?,?)');
  const purge = () => db.prepare('DELETE FROM events WHERE received_at < ?').run(new Date(Date.now() - retention * 86400000).toISOString());
  purge();
  const timer = setInterval(purge, 3600000).unref();
  function reply(res, status, value, type = 'application/json') {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(type === 'application/json' ? JSON.stringify(value) : value);
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') return reply(res, 200, { status: 'ok', service: 'PillarSpec WhatsApp receiver' });
      if (url.pathname === '/webhooks/whatsapp' && req.method === 'GET') {
        if (url.searchParams.get('hub.mode') !== 'subscribe' || !equal(url.searchParams.get('hub.verify_token'), config.verifyToken)) return reply(res, 403, { error: 'Verification failed' });
        const challenge = url.searchParams.get('hub.challenge');
        if (!challenge) return reply(res, 400, { error: 'Missing challenge' });
        return reply(res, 200, challenge, 'text/plain');
      }
      if (url.pathname === '/webhooks/whatsapp' && req.method === 'POST') {
        if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Expected JSON' });
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1048576) { reply(res, 413, { error: 'Payload too large' }); return; }
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks);
        const expected = 'sha256=' + createHmac('sha256', config.appSecret).update(raw).digest('hex');
        if (!equal(req.headers['x-hub-signature-256'], expected)) return reply(res, 401, { error: 'Invalid signature' });
        let payload;
        try { payload = JSON.parse(raw); } catch { return reply(res, 400, { error: 'Invalid JSON' }); }
        if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return reply(res, 400, { error: 'Invalid WhatsApp event' });
        const events = [];
        for (const entry of payload.entry) for (const change of entry.changes ?? []) {
          const value = change.value;
          if (change.field !== 'messages' || value?.metadata?.phone_number_id !== config.phoneNumberId) continue;
          for (const [kind, records] of [['message', value.messages], ['status', value.statuses]]) {
            if (!Array.isArray(records)) continue;
            for (const record of records) {
              if (!record?.id) continue;
              const data = { account: entry.id, metadata: value.metadata, event: record };
              const key = kind === 'message' ? `message:${record.id}` : `status:${createHash('sha256').update(JSON.stringify(data)).digest('hex')}`;
              events.push([key, kind, new Date().toISOString(), JSON.stringify(data)]);
            }
          }
        }
        // Acknowledge only after a durable transaction; Meta may retry failures.
        db.exec('BEGIN IMMEDIATE');
        try { for (const event of events) insert.run(...event); db.exec('COMMIT'); }
        catch (err) { db.exec('ROLLBACK'); throw err; }
        return reply(res, 200, { received: true });
      }
      if (url.pathname === '/api/events' && req.method === 'GET') {
        if (!equal(req.headers.authorization, `Bearer ${config.inboxToken}`)) return reply(res, 401, { error: 'Unauthorized' });
        const after = Number(url.searchParams.get('after') ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) return reply(res, 400, { error: 'Invalid cursor' });
        const rows = db.prepare('SELECT id,kind,received_at,payload FROM events WHERE id > ? ORDER BY id LIMIT 100').all(after);
        return reply(res, 200, { events: rows.map(row => ({ ...row, payload: JSON.parse(row.payload) })), next_cursor: rows.at(-1)?.id ?? after });
      }
      reply(res, 404, { error: 'Not found' });
    } catch {
      // Never print message contents, credentials, headers or request URLs.
      if (!res.headersSent) reply(res, 500, { error: 'Temporary receiver failure' }); else res.destroy();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => { clearInterval(timer); db.close(); });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createReceiver({ appSecret: process.env.META_APP_SECRET, verifyToken: process.env.WEBHOOK_VERIFY_TOKEN,
    inboxToken: process.env.INBOX_API_TOKEN, phoneNumberId: process.env.ALLOWED_PHONE_NUMBER_ID,
    dbPath: process.env.DB_PATH, retentionDays: process.env.RETENTION_DAYS });
  server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1', () => console.log('PillarSpec receiver is listening.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
