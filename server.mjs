import http from 'node:http';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePhone, isOwner, faqReply, generateAiReply } from './assistant.mjs';
import { createOwnerTools, formatToolResult } from './owner-tools.mjs';
import { sendWhatsappText, DeliveryError } from './delivery.mjs';

export const VERSION = '2.0.0';
const WINDOW_MS = 23.75 * 3600000;
const equal = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
};
function integer(value, fallback, min, max, name) {
  const n = Number(value ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}`);
  return n;
}
const errorKinds = new Set(['provider_auth', 'provider_quota', 'provider_rate_limit', 'provider_access', 'model_unavailable',
  'provider_error', 'incomplete_reply', 'empty_reply', 'configuration', 'daily_limit', 'timeout', 'network', 'tool_limit', 'unauthorized_tool', 'shutdown']);

export function createReceiver(config) {
  for (const name of ['appSecret', 'verifyToken', 'inboxToken', 'phoneNumberId']) {
    if (!config[name]) throw new Error(`Missing required configuration: ${name}`);
  }
  if (config.inboxToken.length < 32 || config.verifyToken.length < 32) throw new Error('Use random tokens of at least 32 characters.');
  const automatic = config.autoReply === true, outbound = config.outboundEnabled === true, aiEnabled = config.aiEnabled === true;
  if (automatic && !outbound) throw new Error('AUTO_REPLY_ENABLED requires OUTBOUND_ENABLED');
  if (automatic && !config.whatsappAccessToken) throw new Error('AUTO_REPLY_ENABLED requires WHATSAPP_ACCESS_TOKEN');
  if (aiEnabled && (!automatic || !config.openaiApiKey || !config.openaiModel)) throw new Error('AI_ENABLED requires auto-reply, OPENAI_API_KEY, and OPENAI_MODEL');
  const graphVersion = config.graphVersion ?? 'v23.0';
  if (!/^v\d+\.\d+$/.test(graphVersion)) throw new Error('Invalid META_GRAPH_VERSION');
  const ownerPhone = normalizePhone(config.ownerPhoneNumber);
  if (ownerPhone && !/^\d{8,15}$/.test(ownerPhone)) throw new Error('Invalid OWNER_PHONE_NUMBER');
  const researchEnabled = aiEnabled && config.researchEnabled === true && Boolean(ownerPhone);
  const maxRepliesPerHour = integer(config.maxRepliesPerHour, 20, 1, 120, 'maxRepliesPerHour');
  const maxOwnerRepliesPerHour = integer(config.maxOwnerRepliesPerHour, 120, 1, 300, 'maxOwnerRepliesPerHour');
  const maxDailyAiCalls = integer(config.maxDailyAiCalls, 300, 1, 5000, 'maxDailyAiCalls');
  const retention = integer(config.retentionDays, 30, 1, 365, 'retentionDays');
  const path = config.dbPath ?? './data/events.sqlite';
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, event_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL, received_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, message_key TEXT NOT NULL UNIQUE,
      to_phone TEXT NOT NULL, incoming_text TEXT NOT NULL, reply_text TEXT, is_owner INTEGER NOT NULL,
      created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error_kind TEXT, sent_message_id TEXT);
    CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(state,next_attempt_at);
    CREATE INDEX IF NOT EXISTS outbox_rate ON outbox(to_phone,created_at);
    CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts (message_id TEXT PRIMARY KEY, status TEXT NOT NULL, rank INTEGER NOT NULL,
      error_code INTEGER, received_at TEXT NOT NULL);`);
  // Additive migration supports both the deployed receiver and previous upgrade databases.
  const columns = new Set(db.prepare('PRAGMA table_info(outbox)').all().map(c => c.name));
  for (const [name, type] of [['incoming_at', 'TEXT'], ['last_ai_error', 'TEXT'], ['delivery_state', 'TEXT'], ['source_type', 'TEXT']]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE outbox ADD COLUMN ${name} ${type}`);
  }
  const ownerTools = createOwnerTools(db, ownerPhone);
  const insertEvent = db.prepare('INSERT OR IGNORE INTO events(event_key,kind,received_at,payload) VALUES(?,?,?,?)');
  const enqueue = db.prepare(`INSERT OR IGNORE INTO outbox(message_key,to_phone,incoming_text,is_owner,created_at,incoming_at,state,source_type) VALUES(?,?,?,?,?,?,?,?)`);
  const rateQuery = db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE to_phone=? AND created_at>? AND state NOT IN ('rate_limited','expired')");
  function reserveAiCall() {
    const day = new Date().toISOString().slice(0, 10);
    return Boolean(db.prepare(`INSERT INTO ai_usage(day,calls) VALUES(?,1) ON CONFLICT(day)
      DO UPDATE SET calls=calls+1 WHERE calls<?`).run(day, maxDailyAiCalls).changes);
  }
  const purge = () => {
    const cutoff = new Date(Date.now() - retention * 86400000).toISOString();
    db.prepare('DELETE FROM events WHERE received_at<?').run(cutoff);
    db.prepare("DELETE FROM outbox WHERE state NOT IN ('queued','generating','sending') AND created_at<?").run(cutoff);
    db.prepare('DELETE FROM receipts WHERE received_at<?').run(cutoff);
    db.prepare('DELETE FROM ai_usage WHERE day<?').run(cutoff.slice(0, 10));
    // Explicit owner notes and tasks persist until the owner requests their removal.
    db.prepare('DELETE FROM tool_results WHERE created_at<?').run(cutoff);
  };
  purge();
  const purgeTimer = setInterval(purge, 3600000).unref();
  // Reclaim generation safely. An interrupted send has unknown delivery; do not resend it blindly.
  db.prepare("UPDATE outbox SET state='queued',next_attempt_at=0 WHERE state='generating'").run();
  db.prepare("UPDATE outbox SET state='uncertain',last_error_kind='delivery_unconfirmed' WHERE state IN ('sending','processing')").run();
  let stopped = false, activeWork = null;
  const shutdownController = new AbortController();
  const sender = config.sendFn ?? sendWhatsappText, ai = config.aiFn ?? generateAiReply;

  async function processOutbox() {
    if (!automatic || activeWork || stopped) return;
    activeWork = (async () => {
      let handled = 0;
      while (!stopped && handled++ < 10) {
        const job = db.prepare("SELECT * FROM outbox WHERE state='queued' AND next_attempt_at<=? ORDER BY id LIMIT 1").get(Date.now());
        if (!job) break;
        const incomingAt = Date.parse(job.incoming_at ?? job.created_at);
        if (!Number.isFinite(incomingAt) || Date.now() - incomingAt >= WINDOW_MS) {
          db.prepare("UPDATE outbox SET state='expired',last_error_kind='service_window_closed' WHERE id=?").run(job.id); continue;
        }
        db.prepare("UPDATE outbox SET state='generating',attempts=attempts+1 WHERE id=?").run(job.id);
        try {
          let replyText = job.reply_text;
          if (!replyText) {
            const owner = Boolean(job.is_owner) && isOwner(job.to_phone, ownerPhone);
            const local = faqReply(job.incoming_text, owner);
            replyText = ownerTools.command(job.to_phone, job.message_key, job.incoming_text, { ai: aiEnabled, research: researchEnabled });
            if (!replyText && job.source_type === 'unsupported') replyText = local.language === 'ar'
              ? 'تم استلام رسالتك. معالجة الصوت والصور والملفات غير مفعّلة؛ يرجى إرسال التفاصيل كنص.'
              : 'Your message was received. Audio, image and file processing is not enabled; please send the details as text.';
            if (!replyText && aiEnabled) {
              const history = db.prepare(`SELECT incoming_text,reply_text FROM outbox WHERE to_phone=? AND is_owner=?
                AND id<? AND state='sent' AND source_type!='unsupported' ORDER BY id DESC LIMIT 6`).all(job.to_phone, owner ? 1 : 0, job.id)
                .reverse().flatMap(row => [{ role: 'user', content: row.incoming_text }, { role: 'assistant', content: row.reply_text }]);
              try {
                replyText = await ai({ text: job.incoming_text, owner, language: local.language, history,
                  apiKey: config.openaiApiKey, model: config.openaiModel, researchEnabled: owner && researchEnabled,
                  executeTool: owner ? (name, args) => ownerTools.execute(job.to_phone, job.message_key, name, args) : undefined,
                  reserveAiCall, signal: shutdownController.signal });
              } catch (err) {
                const kind = errorKinds.has(err.code) ? err.code : 'provider_error';
                db.prepare('UPDATE outbox SET last_ai_error=? WHERE id=?').run(kind, job.id);
                const completed = owner && Array.isArray(err.completedTools) ? err.completedTools.map(r => formatToolResult(r, local.language === 'ar')).join('\n') : '';
                replyText = owner ? (completed ? `${completed}\nAI summary unavailable (${kind}).` : local.language === 'ar'
                  ? `لم يكتمل طلب AI (${kind}). بقي طلبك محفوظاً. استخدم /help للملاحظات والمهام.`
                  : `AI could not complete this request (${kind}). Your request is recorded. Use /help for private notes and tasks.`) : local.body;
              }
            }
            replyText ??= local.body;
            if (typeof replyText !== 'string' || !replyText.trim() || replyText.length > 4096) throw new Error('Invalid reply');
            db.prepare('UPDATE outbox SET reply_text=? WHERE id=?').run(replyText, job.id);
          }
          if (stopped) {
            db.prepare("UPDATE outbox SET state='queued',next_attempt_at=0 WHERE id=?").run(job.id); break;
          }
          if (Date.now() - incomingAt >= WINDOW_MS) {
            db.prepare("UPDATE outbox SET state='expired',last_error_kind='service_window_closed' WHERE id=?").run(job.id); continue;
          }
          db.prepare("UPDATE outbox SET state='sending' WHERE id=?").run(job.id);
          const sentId = await sender({ accessToken: config.whatsappAccessToken, phoneNumberId: config.phoneNumberId,
            recipient: job.to_phone, body: replyText, graphVersion, signal: shutdownController.signal });
          if (!sentId) throw new DeliveryError('delivery_unconfirmed', false, true);
          const receipt = db.prepare('SELECT status FROM receipts WHERE message_id=?').get(String(sentId));
          db.prepare("UPDATE outbox SET state='sent',sent_message_id=?,delivery_state=?,last_error_kind=NULL WHERE id=?")
            .run(String(sentId), receipt?.status ?? 'accepted', job.id);
        } catch (err) {
          const attempts = job.attempts + 1;
          const uncertain = err instanceof DeliveryError && err.uncertain;
          const retryable = !(err instanceof DeliveryError) || err.retryable;
          const state = uncertain ? 'uncertain' : (attempts >= 4 || !retryable) ? 'dead' : 'queued';
          const kind = err instanceof DeliveryError ? err.code : 'delivery_or_generation_failed';
          db.prepare('UPDATE outbox SET state=?,next_attempt_at=?,last_error_kind=? WHERE id=?')
            .run(state, Date.now() + Math.min(3600000, 15000 * 2 ** (attempts - 1)), kind, job.id);
        }
      }
    })();
    try { await activeWork; } finally { activeWork = null; }
  }
  const runWorker = () => { void processOutbox().catch(() => { if (config.diagnostics) console.error('PillarSpec worker unavailable'); }); };
  const workerTimer = automatic ? setInterval(runWorker, 3000).unref() : null;
  const reply = (res, status, value, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(type === 'application/json' ? JSON.stringify(value) : value);
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const diagnostic = { type: 'whatsapp_webhook', accepted_events: 0, filtered_changes: 0 };
      if (config.diagnostics && req.method === 'POST' && url.pathname === '/webhooks/whatsapp') {
        res.once('finish', () => console.log(JSON.stringify({ ...diagnostic, status: res.statusCode })));
      }
      if (req.method === 'GET' && url.pathname === '/privacy') return reply(res, 200, readFileSync(new URL('./privacy.html', import.meta.url), 'utf8'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        db.prepare('SELECT 1').get();
        return reply(res, 200, { status: 'ok', service: 'PillarSpec WhatsApp agent', version: VERSION });
      }
      if (url.pathname === '/webhooks/whatsapp' && req.method === 'GET') {
        if (url.searchParams.get('hub.mode') !== 'subscribe' || !equal(url.searchParams.get('hub.verify_token'), config.verifyToken)) return reply(res, 403, { error: 'Verification failed' });
        const challenge = url.searchParams.get('hub.challenge');
        return challenge ? reply(res, 200, challenge, 'text/plain') : reply(res, 400, { error: 'Missing challenge' });
      }
      if (url.pathname === '/webhooks/whatsapp' && req.method === 'POST') {
        if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Expected JSON' });
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1048576) return reply(res, 413, { error: 'Payload too large' });
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks);
        const expected = 'sha256=' + createHmac('sha256', config.appSecret).update(raw).digest('hex');
        if (!equal(req.headers['x-hub-signature-256'], expected)) return reply(res, 401, { error: 'Invalid signature' });
        let payload;
        try { payload = JSON.parse(raw); } catch { return reply(res, 400, { error: 'Invalid JSON' }); }
        if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return reply(res, 400, { error: 'Invalid WhatsApp event' });
        const events = [], jobs = [], receipts = [];
        for (const entry of payload.entry) {
          if (!Array.isArray(entry?.changes)) continue;
          for (const change of entry.changes) {
            const value = change?.value;
            if (change?.field !== 'messages' || value?.metadata?.phone_number_id !== config.phoneNumberId) { diagnostic.filtered_changes++; continue; }
            for (const [kind, records] of [['message', value.messages], ['status', value.statuses]]) {
              if (!Array.isArray(records)) continue;
              for (const record of records) {
                if (typeof record?.id !== 'string' || !record.id) continue;
                const data = { account: entry.id, metadata: value.metadata, event: record };
                const key = kind === 'message' ? `message:${record.id}` : `status:${createHash('sha256').update(JSON.stringify(data)).digest('hex')}`;
                const now = new Date().toISOString();
                events.push([key, kind, now, JSON.stringify(data)]);
                if (kind === 'status' && ['sent', 'delivered', 'read', 'failed'].includes(record.status)) receipts.push(record);
                if (automatic && kind === 'message') {
                  const recipient = normalizePhone(record.from);
                  if (!/^\d{8,15}$/.test(recipient)) continue;
                  const body = record.type === 'text' ? record.text?.body : record.type === 'button' ? record.button?.text
                    : record.type === 'interactive' ? (record.interactive?.button_reply?.title ?? record.interactive?.list_reply?.title) : null;
                  const supported = typeof body === 'string' && body.trim() && body.length <= 4000;
                  const timestamp = record.timestamp ? Number(record.timestamp) * 1000 : Date.now();
                  const validTime = Number.isFinite(timestamp) && timestamp > 0 && timestamp <= Date.now() + 300000;
                  jobs.push([key, recipient, supported ? body : '[Non-text or oversized message]', isOwner(recipient, ownerPhone) ? 1 : 0,
                    now, validTime ? new Date(timestamp).toISOString() : now, validTime && Date.now() - timestamp < WINDOW_MS ? 'queued' : 'expired', supported ? 'text' : 'unsupported']);
                }
              }
            }
          }
        }
        db.exec('BEGIN IMMEDIATE');
        const inserted = new Set();
        try {
          for (const e of events) if (insertEvent.run(...e).changes) inserted.add(e[0]);
          for (const item of jobs) {
            if (!inserted.has(item[0])) continue;
            const recent = rateQuery.get(item[1], new Date(Date.now() - 3600000).toISOString()).n;
            if (item[6] === 'queued' && recent >= (item[3] ? maxOwnerRepliesPerHour : maxRepliesPerHour)) item[6] = 'rate_limited';
            enqueue.run(...item);
          }
          const ranks = { sent: 1, failed: 2, delivered: 3, read: 4 };
          for (const receipt of receipts) {
            const errorCode = Number(receipt.errors?.[0]?.code) || null;
            db.prepare(`INSERT INTO receipts(message_id,status,rank,error_code,received_at) VALUES(?,?,?,?,?)
              ON CONFLICT(message_id) DO UPDATE SET status=excluded.status,rank=excluded.rank,error_code=excluded.error_code,received_at=excluded.received_at
              WHERE excluded.rank>receipts.rank`).run(receipt.id, receipt.status, ranks[receipt.status], errorCode, new Date().toISOString());
            const saved = db.prepare('SELECT status FROM receipts WHERE message_id=?').get(receipt.id);
            db.prepare('UPDATE outbox SET delivery_state=? WHERE sent_message_id=?').run(saved.status, receipt.id);
          }
          db.exec('COMMIT');
        } catch (err) { db.exec('ROLLBACK'); throw err; }
        diagnostic.accepted_events = inserted.size;
        if (automatic) setImmediate(runWorker);
        return reply(res, 200, { received: true });
      }
      if (url.pathname === '/api/agent/status' && req.method === 'GET') {
        if (!equal(req.headers.authorization, `Bearer ${config.inboxToken}`)) return reply(res, 401, { error: 'Unauthorized' });
        const totals = Object.fromEntries(db.prepare('SELECT state,COUNT(*) AS total FROM outbox GROUP BY state').all().map(r => [r.state, r.total]));
        const delivery = Object.fromEntries(db.prepare('SELECT delivery_state,COUNT(*) AS total FROM outbox WHERE delivery_state IS NOT NULL GROUP BY delivery_state').all().map(r => [r.delivery_state, r.total]));
        const failures = Object.fromEntries(db.prepare('SELECT last_ai_error,COUNT(*) AS total FROM outbox WHERE last_ai_error IS NOT NULL GROUP BY last_ai_error').all().map(r => [r.last_ai_error, r.total]));
        const deliveryErrors = Object.fromEntries(db.prepare('SELECT last_error_kind,COUNT(*) AS total FROM outbox WHERE last_error_kind IS NOT NULL GROUP BY last_error_kind').all().map(r => [r.last_error_kind, r.total]));
        const failedCodes = Object.fromEntries(db.prepare("SELECT error_code,COUNT(*) AS total FROM receipts WHERE status='failed' AND error_code IS NOT NULL GROUP BY error_code").all().map(r => [r.error_code, r.total]));
        const lastEvent = db.prepare("SELECT MAX(received_at) AS at FROM events WHERE kind='message'").get().at;
        const usage = db.prepare('SELECT calls FROM ai_usage WHERE day=?').get(new Date().toISOString().slice(0, 10))?.calls ?? 0;
        return reply(res, 200, { version: VERSION, auto_reply_enabled: automatic, outbound_enabled: outbound, ai_enabled: aiEnabled,
          research_enabled: researchEnabled, owner_mode_configured: Boolean(ownerPhone), owner_tools: Boolean(ownerPhone),
          external_accounts_connected: false, last_incoming_at: lastEvent, ai_calls_today: usage, ai_daily_limit: maxDailyAiCalls,
          outbox: totals, delivery, delivery_errors: deliveryErrors, failed_delivery_codes: failedCodes, ai_failures: failures });
      }
      if (url.pathname === '/api/events' && req.method === 'GET') {
        if (!equal(req.headers.authorization, `Bearer ${config.inboxToken}`)) return reply(res, 401, { error: 'Unauthorized' });
        const after = Number(url.searchParams.get('after') ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) return reply(res, 400, { error: 'Invalid cursor' });
        const rows = db.prepare('SELECT id,kind,received_at,payload FROM events WHERE id>? ORDER BY id LIMIT 100').all(after);
        return reply(res, 200, { events: rows.map(row => ({ ...row, payload: JSON.parse(row.payload) })), next_cursor: rows.at(-1)?.id ?? after });
      }
      return reply(res, 404, { error: 'Not found' });
    } catch { if (!res.headersSent) reply(res, 500, { error: 'Temporary receiver failure' }); else res.destroy(); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => {
    stopped = true; clearInterval(purgeTimer); if (workerTimer) clearInterval(workerTimer); shutdownController.abort();
    if (activeWork) void activeWork.finally(() => db.close()).catch(() => {}); else db.close();
  });
  server.shutdown = () => {
    stopped = true; shutdownController.abort();
    return new Promise(resolve => server.close(() => Promise.resolve(activeWork).catch(() => {}).finally(resolve)));
  };
  // Recover queued jobs on startup even if no fresh webhook arrives.
  if (automatic) setImmediate(runWorker);
  return server;
}

export function configFromEnv(env = process.env) {
  return { appSecret: env.META_APP_SECRET, verifyToken: env.WEBHOOK_VERIFY_TOKEN, inboxToken: env.INBOX_API_TOKEN,
    phoneNumberId: env.ALLOWED_PHONE_NUMBER_ID, dbPath: env.DB_PATH, retentionDays: env.RETENTION_DAYS,
    diagnostics: env.WEBHOOK_DIAGNOSTICS === 'true', autoReply: env.AUTO_REPLY_ENABLED === 'true',
    outboundEnabled: env.OUTBOUND_ENABLED === 'true', aiEnabled: env.AI_ENABLED === 'true', researchEnabled: env.RESEARCH_ENABLED === 'true',
    openaiApiKey: env.OPENAI_API_KEY, openaiModel: env.OPENAI_MODEL, whatsappAccessToken: env.WHATSAPP_ACCESS_TOKEN,
    graphVersion: env.META_GRAPH_VERSION, ownerPhoneNumber: env.OWNER_PHONE_NUMBER, maxRepliesPerHour: env.MAX_REPLIES_PER_HOUR,
    maxOwnerRepliesPerHour: env.MAX_OWNER_REPLIES_PER_HOUR, maxDailyAiCalls: env.MAX_AI_CALLS_PER_DAY };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createReceiver(configFromEnv());
  server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '0.0.0.0', () => console.log(`PillarSpec agent ${VERSION} is listening.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.shutdown(); });
}
