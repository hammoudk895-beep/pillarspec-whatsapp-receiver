import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createReceiver } from './server.mjs';

test('verification, signatures, number isolation, durable deduplication and inbox access', async t => {
  const config = { appSecret: 'test-secret', verifyToken: 'v'.repeat(32), inboxToken: 'i'.repeat(32), phoneNumberId: '1367620946438403', dbPath: ':memory:' };
  const server = createReceiver(config);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let r = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${config.verifyToken}&hub.challenge=1234`);
  assert.equal(r.status, 200); assert.equal(await r.text(), '1234');
  assert.equal((await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1234`)).status, 403);
  const event = phone => ({ object: 'whatsapp_business_account', entry: [{ id: 'account', changes: [{ field: 'messages', value: { metadata: { phone_number_id: phone }, messages: [{ id: 'm1', from: 'test', type: 'text', text: { body: 'Hello' } }], statuses: [{ id: 'm1', status: 'delivered', timestamp: '1' }] } }] }] });
  const send = (payload, signature = true) => {
    const body = JSON.stringify(payload);
    return fetch(`${base}/webhooks/whatsapp`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ? 'sha256=' + createHmac('sha256', config.appSecret).update(body).digest('hex') : 'sha256=bad' } });
  };
  assert.equal((await send(event(config.phoneNumberId), false)).status, 401);
  assert.equal((await send(event('other'))).status, 200);
  assert.equal((await send(event(config.phoneNumberId))).status, 200);
  assert.equal((await send(event(config.phoneNumberId))).status, 200);
  assert.equal((await fetch(`${base}/api/events`)).status, 401);
  r = await fetch(`${base}/api/events`, { headers: { authorization: `Bearer ${config.inboxToken}` } });
  const inbox = await r.json();
  assert.equal(inbox.events.length, 2); assert.equal(inbox.events[0].kind, 'message'); assert.equal(inbox.events[1].kind, 'status');
  r = await fetch(`${base}/api/events?after=${inbox.next_cursor}`, { headers: { authorization: `Bearer ${config.inboxToken}` } });
  assert.deepEqual((await r.json()).events, []);
  assert.equal((await send({ object: 'wrong' })).status, 400);
});
