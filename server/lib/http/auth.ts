// Rechtencontrole per verzoek. Elke API-route vraagt hier de ingelogde gebruiker en controleert
// dat het gevraagde record in de eigen werkruimte ligt, met minimaal de benodigde rol.
import type { H3Event } from 'h3';
import { atLeast, type Role } from '../../../shared/roles';
import type { Asset, ExportRecord, Generation, Mockup, Project, Scene } from '../../../shared/types';
import { resolveSession, SESSION_DAYS } from '../auth/accounts';
import { AppError, notFound } from '../errors';
import { assets, exportsRepo, generations, mockups, projects, scenes } from '../repositories';
import { memberships, workspaces, type Session, type User, type Workspace } from '../repo-accounts';

export const SESSION_COOKIE = 'ms_session';

export interface AuthContext { user: User; session: Session; token: string; workspace: Workspace | null; role: Role | null }
export interface WorkspaceContext extends AuthContext { workspace: Workspace; role: Role }

export function setSessionCookie(event: H3Event, token: string, expiresAt: string) {
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getRequestProtocol(event, { xForwardedProto: true }) === 'https',
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(event: H3Event) {
  deleteCookie(event, SESSION_COOKIE, { path: '/' });
}

export function getAuth(event: H3Event): AuthContext | null {
  if (event.context.auth !== undefined) return event.context.auth as AuthContext | null;
  const token = getCookie(event, SESSION_COOKIE);
  let ctx: AuthContext | null = null;
  if (token && token.length < 200) {
    const r = resolveSession(token);
    if (r) {
      const ws = r.session.workspaceId ? workspaces.get(r.session.workspaceId) : null;
      const role = ws ? memberships.role(ws.id, r.user.id) : null;
      ctx = { user: r.user, session: r.session, token, workspace: role ? ws : null, role };
      if (r.renewedUntil) setSessionCookie(event, token, r.renewedUntil);
    } else {
      clearSessionCookie(event);
    }
  }
  event.context.auth = ctx;
  return ctx;
}

export function requireUser(event: H3Event): AuthContext {
  const a = getAuth(event);
  if (!a) throw new AppError(401, 'Je bent niet ingelogd.', 'unauthenticated');
  return a;
}

/** Ingelogd, met een actieve werkruimte en minimaal de gevraagde rol. */
export function requireWorkspace(event: H3Event, min: Role = 'viewer'): WorkspaceContext {
  const a = requireUser(event);
  if (!a.workspace || !a.role) throw new AppError(403, 'Je hebt geen actieve werkruimte. Kies er een of maak er een aan.', 'no_workspace');
  if (!atLeast(a.role, min)) throw new AppError(403, rolMelding(min), 'forbidden');
  return a as WorkspaceContext;
}

function rolMelding(min: Role) {
  return min === 'member' ? 'Met de rol kijker kun je hier niets wijzigen.' : min === 'admin' ? 'Alleen beheerders en de eigenaar kunnen dit.' : min === 'owner' ? 'Alleen de eigenaar kan dit.' : 'Je hebt hier geen toegang toe.';
}

export function requireProject(event: H3Event, id: string, min: Role = 'viewer'): { ctx: WorkspaceContext; project: Project } {
  const ctx = requireWorkspace(event, min);
  const project = projects.get(id);
  // Bestaat het niet of hoort het bij een andere werkruimte: in beide gevallen "niet gevonden".
  if (!project || project.workspaceId !== ctx.workspace.id) throw notFound('Project');
  return { ctx, project };
}

export function requireAsset(event: H3Event, id: string, min: Role = 'viewer'): { ctx: WorkspaceContext; asset: Asset; project: Project } {
  const asset = assets.get(id);
  if (!asset) throw notFound('Bestand');
  const { ctx, project } = requireProject(event, asset.projectId, min);
  return { ctx, asset, project };
}

export function requireMockup(event: H3Event, id: string, min: Role = 'viewer'): { ctx: WorkspaceContext; mockup: Mockup; project: Project } {
  const mockup = mockups.get(id);
  if (!mockup) throw notFound('Mockup');
  const { ctx, project } = requireProject(event, mockup.projectId, min);
  return { ctx, mockup, project };
}

export function requireGeneration(event: H3Event, id: string, min: Role = 'viewer'): { ctx: WorkspaceContext; generation: Generation; project: Project } {
  const generation = generations.get(id);
  if (!generation) throw notFound('Generatie');
  const { ctx, project } = requireProject(event, generation.projectId, min);
  return { ctx, generation, project };
}

export function requireExport(event: H3Event, id: string): { ctx: WorkspaceContext; record: ExportRecord } {
  const record = exportsRepo.get(id);
  if (!record) throw notFound('Export');
  const { ctx } = requireProject(event, record.projectId, 'viewer');
  return { ctx, record };
}

/**
 * Scènes: lezen mag als het een systeemscène is of in de eigen werkruimte ligt. Wijzigen mag alleen
 * binnen de eigen werkruimte (lid of hoger), of voor platformbeheerders ook in de systeembibliotheek.
 */
export function requireScene(event: H3Event, id: string, mode: 'read' | 'write'): { ctx: WorkspaceContext; scene: Scene } {
  const ctx = requireWorkspace(event, mode === 'write' ? 'member' : 'viewer');
  const scene = scenes.get(id);
  if (!scene) throw notFound('Scène');
  const own = scene.workspaceId === ctx.workspace.id;
  const system = scene.workspaceId === null;
  if (!own && !system) throw notFound('Scène');
  // Nog niet gepubliceerde bibliotheekscène: alleen voor platformbeheerders.
  if (system && !scene.inLibrary && !ctx.user.isAdmin) throw notFound('Scène');
  if (mode === 'write' && system && !ctx.user.isAdmin) throw new AppError(403, 'Scènes uit de standaardbibliotheek kun je niet wijzigen. Gebruik ze in een mockup of voeg een eigen foto toe.', 'forbidden');
  return { ctx, scene };
}

export function requirePlatformAdmin(event: H3Event): AuthContext {
  const a = requireUser(event);
  if (!a.user.isAdmin) throw notFound('Pagina');
  return a;
}

export const sessionMaxAgeDays = SESSION_DAYS;
