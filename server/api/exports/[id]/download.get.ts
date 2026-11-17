import { projects } from '../../../lib/repositories';
import { storage } from '../../../lib/storage';

import { apiHandler, param } from '../../../lib/http/api';
import { requireExport } from '../../../lib/http/auth';
export default apiHandler(async (event) => {
  const { record: e } = requireExport(event, param(event));
  const name = `${(projects.get(e.projectId)?.name ?? 'mockup').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').toLowerCase()}-${e.id.slice(0, 6)}.${e.format === 'tiff' ? 'tif' : e.format}`;
  setHeader(event, 'Content-Type', e.format === 'png' ? 'image/png' : e.format === 'tiff' ? 'image/tiff' : e.format === 'mp4' ? 'video/mp4' : 'image/jpeg');
  setHeader(event, 'Content-Disposition', `attachment; filename="${name}"`);
  return storage.read(e.file);
});
