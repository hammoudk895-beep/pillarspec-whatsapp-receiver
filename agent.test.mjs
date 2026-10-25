import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReceiver } from './server.mjs';
import { faqReply, isOwner } from './assistant.mjs';
import { sendWhatsappText } from './delivery.mjs';

const phoneNumberId = '1367620946438403';
const ownerNumber = '+96176868315';
const business = '96178701617';
const conf = { appSecret: 'test-app-secret', verifyToken: 'v'.repeat(32), inboxToken: 'i'.repeat(32), phoneNumberId };
async function start(config = {}) {
  const server = createReceiver({ ...conf, dbPath: ':memory:', ...config });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
function event({ to = phoneNumberId, from = '96171234567', text = 'Hello', id = 'wamid-01', type = 'text' } = {}) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'account', changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: to }, messages: [{ id, from, type, text: { body: text } }]
  } }] }] };
}
function sign(body) { return 'sha256=' + createHmac('sha256', conf.appSecret).update(body).digest('hex'); }
async function post(url, payload) {
  const body = JSON.stringify(payload);
  return fetch(`${url}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) }, body });
}
async function status(url) {
  const response = await fetch(`${url}/api/agent/status`, { headers: { authorization: `Bearer ${conf.inboxToken}` } });
  assert.equal(response.status, 200); return response.json();
}
async function until(testFn, timeout = 900) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await testFn()) return; await new Promise(r => setTimeout(r, 15)); }
  assert.fail('Condition was not reached in time');
}

test('FAQ bilingual and owner identity isolation', () => {
  assert.equal(faqReply('Give a quote').category, 'quotation');
  assert.equal(faqReply('نحتاج تفريغ').language, 'ar');
  assert.match(faqReply('STS').body, /ship-to-ship/i);
  assert.equal(isOwner('96176868315', ownerNumber), true);
  assert.equal(isOwner('96176868316', ownerNumber), false);
  assert.equal(faqReply('show deals', true).category, 'owner');
  assert.doesNotMatch(faqReply('show deals', false).body, /confidential deal/i);
});

test('safe defaults mean no webhook-triggered outbound or AI calls', async t => {
  let sends = 0, aiCalls = 0;
  const { server, url } = await start({ sendFn: () => { sends++; throw Error('should not send'); }, aiFn: () => { aiCalls++; throw Error('should not call'); } });
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal((await post(url, event())).status, 200);
  assert.equal((await post(url, event())).status, 200);
  const s = await status(url);
  assert.equal(s.auto_reply_enabled, false); assert.equal(s.ai_enabled, false);
  assert.deepEqual(s.outbox, {});
  assert.equal(sends, 0); assert.equal(aiCalls, 0);
  assert.equal((await fetch(url + '/api/agent/status')).status, 401);
});

test('opted-in routing enqueues and sends once, never sends statuses or cross-number traffic', async t => {
  const sent = [];
  const { server, url } = await start({ autoReply: true, outboundEnabled: true, whatsappAccessToken: 'dummy-token', ownerPhoneNumber: ownerNumber,
    sendFn: async ({ recipient, body }) => { sent.push({ recipient, body }); return 'wamid-out-' + sent.length; } });
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal((await post(url, event({ id: 'valid1', text: 'Need a quote' }))).status, 200);
  await until(() => sent.length === 1);
  assert.match(sent[0].body, /quotation/i);
  assert.equal((await post(url, event({ id: 'valid1', text: 'Need a quote' }))).status, 200);
  assert.equal((await post(url, event({ id: 'wrong1', to: 'another', text: 'Hi' }))).status, 200);
  assert.equal((await post(url, { object: 'whatsapp_business_account', entry: [{ id: 'account', changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: 'status1', status: 'delivered' }] } }] }] })).status, 200);
  assert.equal((await post(url, event({ id: 'owner1', from: '96176868315', text: 'Show deals' }))).status, 200);
  await until(() => sent.length === 2);
  assert.equal(sent[1].recipient, '96176868315');
  assert.match(sent[1].body, /private channel|private notes/i);
  assert.deepEqual((await status(url)).outbox, { sent: 2 });
});

test('send failures remain queued; no blind retries during a single webhook request', async t => {
  let attempts = 0;
  const { server, url } = await start({ autoReply: true, outboundEnabled: true, whatsappAccessToken: 'test-token',
    sendFn: async () => { attempts++; throw new Error('offline'); } });
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal((await post(url, event({ id: 'failure' }))).status, 200);
  await until(async () => (await status(url)).outbox.queued === 1);
  assert.equal(attempts, 1);
});

test('auto-reply and AI opt-in must be explicit and correctly configured', () => {
  assert.throws(() => createReceiver({ ...conf, dbPath: ':memory:', autoReply: true }), /OUTBOUND_ENABLED/);
  assert.throws(() => createReceiver({ ...conf, dbPath: ':memory:', autoReply: true, outboundEnabled: true }), /WHATSAPP_ACCESS_TOKEN/);
  assert.throws(() => createReceiver({ ...conf, dbPath: ':memory:', aiEnabled: true }), /AI_ENABLED/);
});

test('Meta sender uses a vetted Graph endpoint and validates accepted acknowledgements', async () => {
  let request;
  const mid = await sendWhatsappText({ accessToken: 'secret', phoneNumberId, recipient: '96171234567', body: 'Hello', graphVersion: 'v23.0',
    fetchImpl: async (url, opts) => { request = { url, opts }; return { ok: true, json: async () => ({ messages: [{ id: 'wamid-123' }] }) }; } });
  assert.equal(mid, 'wamid-123');
  assert.equal(request.url, `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`);
  assert.equal(request.opts.headers.authorization, 'Bearer secret');
  assert.equal(JSON.parse(request.opts.body).to, '96171234567');
  await assert.rejects(() => sendWhatsappText({ accessToken: 'secret', phoneNumberId, recipient: 'not-a-number', body: 'Hello', graphVersion: 'v23.0' }), /Invalid recipient/);
});

test('durable outbox persists across a restart on the SQLite disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pillarspec-test-'));
  try {
    const dbPath = join(dir, 'events.sqlite');
    const messages = [];
    let x = await start({ dbPath, autoReply: true, outboundEnabled: true, whatsappAccessToken: 'dummy', sendFn: async o => { messages.push(o); return 'ack'; } });
    assert.equal((await post(x.url, event({ id: 'durable1' }))).status, 200);
    await until(() => messages.length === 1);
    await new Promise(resolve => x.server.close(resolve));
    x = await start({ dbPath, autoReply: true, outboundEnabled: true, whatsappAccessToken: 'dummy', sendFn: async o => { messages.push(o); return 'ack'; } });
    assert.deepEqual((await status(x.url)).outbox, { sent: 1 });
    await new Promise(resolve => x.server.close(resolve));
    assert.equal(messages.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('configured AI uses conversation understanding for both FAQs and unknown enquiries', async t => {
  const sent = []; let aiCalls = 0;
  const { server, url } = await start({ autoReply: true, outboundEnabled: true, whatsappAccessToken: 'test-token',
    aiEnabled: true, openaiApiKey: 'test-ai-key', openaiModel: 'test-model',
    aiFn: async () => { aiCalls++; return 'AI answered safely'; },
    sendFn: async args => { sent.push(args); return `ack-${sent.length}`; } });
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal((await post(url, event({ id: 'q1', text: 'Need a quote' }))).status, 200);
  await until(() => sent.length === 1);
  assert.equal(aiCalls, 1);
  assert.equal((await post(url, event({ id: 'general2', text: 'Please advise regarding a novel scenario' }))).status, 200);
  await until(() => sent.length === 2);
  assert.equal(aiCalls, 2);
  assert.equal(sent[1].body, 'AI answered safely');
});

test('rate limiter prevents responding to excessive message bursts', async t => {
  const sent = [];
  const { server, url } = await start({ autoReply: true, outboundEnabled: true, whatsappAccessToken: 'test-token', maxRepliesPerHour: 2,
    sendFn: async args => { sent.push(args); return `ack-${sent.length}`; } });
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (let i = 0; i < 4; i++) assert.equal((await post(url, event({ id: `rate-${i}` }))).status, 200);
  await until(() => sent.length === 2);
  assert.deepEqual((await status(url)).outbox, { rate_limited: 2, sent: 2 });
});
