import { badRequest } from '../../../lib/errors';
import { rateLimit } from '../../../lib/ratelimit';
import { replaceAsset } from '../../../lib/versions';

import { apiHandler, param } from '../../../lib/http/api';
import { requireAsset } from '../../../lib/http/auth';
import { present } from '../../../lib/http/present';
/** Nieuwe versie van een ontwerp uploaden; alle mockups met dit ontwerp worden bijgewerkt. */
export default apiHandler(async (event) => {
  const { asset, ctx } = requireAsset(event, param(event), 'member');
  rateLimit(`upload:${ctx.user.id}`, 200, 3600_000, 'Je hebt in korte tijd heel veel bestanden geüpload.');
  const parts = await readMultipartFormData(event);
  const file = parts?.find((p) => p.name === 'file' && p.filename);
  if (!file) throw badRequest('Er is geen bestand meegestuurd.');
  const note = parts?.find((p) => p.name === 'note')?.data.toString().slice(0, 200) ?? '';
  const res = await replaceAsset(asset, file.data, { filename: file.filename, note, userId: ctx.user.id });
  return { changed: res.changed, affectedMockups: res.affectedMockups, asset: present.asset(res.asset) };
});
