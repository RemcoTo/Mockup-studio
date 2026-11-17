import { handleEvent, verifyWebhook } from '../../lib/billing/stripe';

import { apiHandler } from '../../lib/http/api';
/** Stripe-webhook. Geen sessie of Origin; de handtekening bewijst dat het bericht van Stripe komt. */
export default apiHandler(async (event) => {
  const raw = await readRawBody(event, false);
  const evt = verifyWebhook(raw ?? Buffer.alloc(0), getRequestHeader(event, 'stripe-signature'));
  return { received: true, result: await handleEvent(evt) };
});
