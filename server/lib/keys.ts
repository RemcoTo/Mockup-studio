// Indeling van de bestandsopslag: alles van een werkruimte onder ws/<id>/, de systeembibliotheek onder system/.
import path from 'node:path';

export const keys = {
  workspace: (ws: string) => `ws/${ws}`,
  asset: (ws: string, id: string) => `ws/${ws}/assets/${id}`,
  original: (ws: string, projectId: string) => `ws/${ws}/originals/${projectId}`,
  scene: (ws: string | null, id: string) => (ws ? `ws/${ws}/scenes/${id}` : `system/scenes/${id}`),
  mockup: (ws: string, id: string) => `ws/${ws}/mockups/${id}`,
  exports: (ws: string, projectId: string) => `ws/${ws}/exports/${projectId}`,
  previews: (ws: string, sceneId: string) => `ws/${ws}/previews/${sceneId}`,
  media: (ws: string, id: string) => `ws/${ws}/media/${id}`,
};

/** Map van een opgeslagen bestand; werkt voor de huidige en de oudere indeling. */
export const dirOf = (key: string) => path.posix.dirname(key);
