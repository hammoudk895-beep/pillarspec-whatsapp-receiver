export class DeliveryError extends Error {
  constructor(kind, retryable = false, uncertain = false) { super(kind); this.code = kind; this.retryable = retryable; this.uncertain = uncertain; }
}

export async function sendWhatsappText({ accessToken, phoneNumberId, recipient, body, graphVersion, fetchImpl = fetch, signal }) {
  if (!accessToken || !/^\d+$/.test(phoneNumberId ?? '') || !/^\d{8,15}$/.test(recipient ?? '') || typeof body !== 'string' || !body || body.length > 4096) {
    throw new DeliveryError('Invalid recipient or sender configuration');
  }
  if (!/^v\d+\.\d+$/.test(graphVersion)) throw new DeliveryError('Invalid Graph API version');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    let res;
    try {
      if (signal?.aborted) throw new Error('shutdown');
      res = await fetchImpl(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: 'POST', signal: controller.signal,
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient,
          type: 'text', text: { preview_url: false, body } })
      });
    } catch { throw new DeliveryError('delivery_unconfirmed', false, true); }
    let payload;
    try { payload = await res.json(); } catch { throw new DeliveryError('delivery_unconfirmed', false, true); }
    if (!res.ok) {
      const code = Number(payload.error?.code);
      if (code === 131047) throw new DeliveryError('service_window_closed');
      if (res.status === 401 || code === 190) throw new DeliveryError('whatsapp_auth');
      if (res.status === 403) throw new DeliveryError('whatsapp_permissions');
      const retryable = res.status === 429 || payload.error?.is_transient === true;
      throw new DeliveryError(retryable ? 'whatsapp_rate_or_transient' : 'whatsapp_rejected', retryable);
    }
    if (!payload.messages?.[0]?.id) throw new DeliveryError('delivery_unconfirmed', false, true);
    return payload.messages[0].id;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
}
