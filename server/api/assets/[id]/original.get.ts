import { storage } from '../../../lib/storage';

import { apiHandler, param } from '../../../lib/http/api';
import { requireAsset } from '../../../lib/http/auth';
/** Het originele bestand, ongewijzigd, als download. SVG's worden nooit inline uitgevoerd. */
export default apiHandler(async (event) => {
  const { asset } = requireAsset(event, param(event));
  setHeader(event, 'Content-Type', asset.mime);
  setHeader(event, 'Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`);
  setHeader(event, 'Content-Security-Policy', "default-src 'none'; sandbox");
  setHeader(event, 'X-Content-Type-Options', 'nosniff');
  return storage.read(asset.file);
});
