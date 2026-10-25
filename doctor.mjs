import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFromEnv } from './server.mjs';
import { generateAiReply } from './ai.mjs';

// Diagnostics output consists of booleans, fixed error categories and status codes only.
export async function checkDeployment(env = process.env, { fetchImpl = fetch, liveAi = false } = {}) {
  const config = configFromEnv(env), checks = [];
  for (const key of ['META_APP_SECRET', 'WEBHOOK_VERIFY_TOKEN', 'INBOX_API_TOKEN', 'ALLOWED_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'OPENAI_API_KEY', 'OPENAI_MODEL']) {
    checks.push({ check: key, ok: Boolean(env[key]?.trim()) });
  }
  for (const key of ['OUTBOUND_ENABLED', 'AUTO_REPLY_ENABLED', 'AI_ENABLED', 'RESEARCH_ENABLED']) checks.push({ check: key, ok: env[key] === 'true' });
  checks.push({ check: 'owner_number', ok: env.OWNER_PHONE_NUMBER?.replace(/\D/g, '') === '96176868315' });
  const base = env.AGENT_BASE_URL ?? env.RENDER_EXTERNAL_URL;
  if (base) {
    let url;
    try { url = new URL(base); } catch { checks.push({ check: 'service_url', ok: false }); }
    if (url && url.protocol === 'https:' && !url.username && !url.password) {
      try {
        const res = await fetchImpl(new URL('/healthz', url), { signal: AbortSignal.timeout(15000) });
        checks.push({ check: 'new_build_live', ok: res.ok && (await res.json()).version === '2.0.0' });
        if (env.INBOX_API_TOKEN) {
          const status = await fetchImpl(new URL('/api/agent/status', url), { headers: { authorization: `Bearer ${env.INBOX_API_TOKEN}` }, signal: AbortSignal.timeout(15000) });
          const body = status.ok ? await status.json() : {};
          checks.push({ check: 'agent_status', ok: status.ok && body.version === '2.0.0' && body.ai_enabled === true && body.research_enabled === true });
        }
      } catch { checks.push({ check: 'service_reachable', ok: false }); }
    }
  }
  if (config.whatsappAccessToken && config.phoneNumberId && /^v\d+\.\d+$/.test(config.graphVersion ?? '')) {
    try {
      const response = await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(config.phoneNumberId)}?fields=display_phone_number`, {
        headers: { authorization: `Bearer ${config.whatsappAccessToken}` }, signal: AbortSignal.timeout(15000) });
      const body = response.ok ? await response.json() : {};
      checks.push({ check: 'whatsapp_sender', ok: response.ok && body.display_phone_number?.replace(/\D/g, '') === '96178701617' });
    } catch { checks.push({ check: 'whatsapp_sender', ok: false }); }
  }
  if (liveAi && config.openaiApiKey && config.openaiModel) {
    try {
      const reply = await generateAiReply({ text: 'Reply with READY only.', owner: false, apiKey: config.openaiApiKey, model: config.openaiModel, fetchImpl });
      checks.push({ check: 'live_ai', ok: reply.trim() === 'READY' });
    } catch (err) { checks.push({ check: 'live_ai', ok: false, reason: /^[a-z_]+$/.test(err.code ?? '') ? err.code : 'failed' }); }
  }
  return { ok: checks.every(c => c.ok), checks, whatsapp_round_trip_verified: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkDeployment(process.env, { liveAi: process.argv.includes('--live-ai') });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
