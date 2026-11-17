import { assetVersions } from '../../../../lib/repositories';
import { fileUrl } from '../../../../lib/storage';

import { apiHandler, param } from '../../../../lib/http/api';
import { requireAsset } from '../../../../lib/http/auth';
export default apiHandler((event) => {
  const { asset } = requireAsset(event, param(event), 'viewer');
  return {
    current: { version: asset.version, updatedAt: asset.updatedAt ?? asset.createdAt, note: typeof asset.meta.versionNote === 'string' ? asset.meta.versionNote : '' },
    versions: assetVersions.list(asset.id).map((v) => ({ id: v.id, version: v.version, originalName: v.originalName, width: v.width, height: v.height, note: v.note, createdAt: v.createdAt, previewUrl: fileUrl(v.preview) })),
  };
});
