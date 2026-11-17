import { findDeviceModel } from '../../../shared/device3d/spec';
// Voegt bestands-URL's toe aan records voor de interface.
import type { Asset, ExportRecord, Mockup, Scene } from '../../../shared/types';
import { fileUrl } from '../storage';

export const present = {
  asset: (a: Asset) => ({
    ...a,
    previewUrl: fileUrl(a.preview),
    originalUrl: `/api/assets/${a.id}/original`,
  }),
  scene: (s: Scene) => ({
    ...s,
    fileUrl: fileUrl(s.file),
    thumbUrl: fileUrl(s.thumb),
    surfaces: s.surfaces.map((x) => ({ ...x, maskUrl: fileUrl(x.maskFile), shadingUrl: fileUrl(x.shadingFile) })),
    // 3D-device: achtergrond zonder device en het model, voor de live weergave in de editor.
    device3d: s.device3d ? { ...s.device3d, backgroundUrl: fileUrl(s.device3d.background), modelUrl: `/models/devices/${findDeviceModel(s.device3d.spec.model)?.file ?? ''}` } : null,
  }),
  mockup: (m: Mockup) => ({ ...m, previewUrl: fileUrl(m.previewFile) }),
  export: (e: ExportRecord) => ({ ...e, url: fileUrl(e.file), downloadUrl: `/api/exports/${e.id}/download` }),
};
