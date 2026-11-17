import { z } from 'zod';
import { setAutoRefresh } from '../../../lib/capture/living';
import { parse } from '../../../lib/validation';

import { apiHandler, param } from '../../../lib/http/api';
import { requireAsset } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
/** Automatisch bijwerken van een vastgelegde website: uit, dagelijks of wekelijks. */
export default apiHandler(async (event) => {
  const { asset } = requireAsset(event, param(event), 'member');
  const { interval } = parse(z.object({ interval: z.enum(['off', 'daily', 'weekly']) }), await readBody(event));
  return present.asset(setAutoRefresh(asset, interval));
});
