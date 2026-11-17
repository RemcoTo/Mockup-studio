import type { Asset, ExportRecord, Generation, Mockup, Project, Scene, Surface } from '~~/shared/types';

export type AssetView = Asset & { previewUrl: string; originalUrl: string; projectName?: string };
export type SurfaceView = Surface & { maskUrl: string | null; shadingUrl: string | null };
export type SceneView = Omit<Scene, 'surfaces' | 'device3d'> & {
  fileUrl: string; thumbUrl: string; surfaces: SurfaceView[]; editable?: boolean;
  device3d?: (NonNullable<Scene['device3d']> & { backgroundUrl: string | null; modelUrl: string }) | null;
};
export type MockupView = Mockup & { previewUrl: string | null };
export type ExportView = ExportRecord & { url: string; downloadUrl: string };
export type ProjectSummary = Project & { mockupCount: number; coverUrl: string | null; coverIsMockup: boolean };
export interface ProjectDetail { project: Project; role: import('~~/shared/roles').Role; assets: AssetView[]; mockups: MockupView[]; scenes: SceneView[]; generations: Generation[]; exports: ExportView[] }
export interface ProviderInfo { id: string; label: string; model: string; configured: boolean; problem: string | null; maxCount: number; supportsReferences: boolean; isAi: boolean }
export interface StatusInfo {
  provider: ProviderInfo; providers: ProviderInfo[]; browser: { installed: boolean }; uploadMaxMb: number; captureAllowPrivate: boolean;
  pricing: { source: { label: string; url: string }; table: Record<string, Record<'low' | 'medium' | 'high', Record<string, number>>>; credits: Record<'low' | 'medium' | 'high', number> };
  mailMode: 'smtp' | 'outbox'; creditsEnforced: boolean; limits: { aiDailyUsd: number; aiWorkspaceDailyUsd: number };
}

export const dateNl = (iso: string) => new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
export const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'zojuist';
  if (s < 3600) return `${Math.floor(s / 60)} min geleden`;
  if (s < 86400) return `${Math.floor(s / 3600)} uur geleden`;
  return dateNl(iso);
};
