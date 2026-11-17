import { libraryRuns } from '../../../lib/repositories';
import { libraryPreview, pendingScenes, presetOverview, PUBLISH_QUALITY, sceneQuality } from '../../../lib/library/pipeline';

import { apiHandler } from '../../../lib/http/api';
import { present } from '../../../lib/http/present';
import { requirePlatformAdmin } from '../../../lib/http/auth';
/** Bibliotheekbeheer: presets, beoordelingsrij en recente runs. Alleen voor platformbeheerders. */
export default apiHandler((event) => {
  requirePlatformAdmin(event);
  const preview = libraryPreview([], 'medium');
  return {
    provider: preview.provider,
    spend: preview.spend,
    publishQuality: PUBLISH_QUALITY,
    presets: presetOverview(),
    pending: pendingScenes().map((s) => ({ ...present.scene(s), quality: sceneQuality(s) })),
    runs: libraryRuns.recent(40),
  };
});
