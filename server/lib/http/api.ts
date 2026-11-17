import type { H3Event } from 'h3';
import { AppError } from '../errors';
import { log } from '../log';
import '../errortracking';
import { maskPath } from '../log';

/** Zet fouten om naar nette HTTP-antwoorden met een Nederlandse melding. */
export function apiHandler<T>(fn: (event: H3Event) => Promise<T> | T) {
  return defineEventHandler(async (event) => {
    try {
      return await fn(event);
    } catch (e) {
      if (e instanceof AppError) {
        throw createError({ statusCode: e.status, statusMessage: e.code, message: e.message, data: { code: e.code, message: e.message } });
      }
      if ((e as { statusCode?: number }).statusCode) throw e;
      log.error('api.unhandled', { path: maskPath(event.path), method: event.method, error: (e as Error).message, stack: (e as Error).stack });
      throw createError({ statusCode: 500, message: 'Er ging iets mis op de server. Probeer het opnieuw.', data: { code: 'server_error', message: 'Er ging iets mis op de server. Probeer het opnieuw.' } });
    }
  });
}

export function param(event: H3Event, name = 'id'): string {
  const v = getRouterParam(event, name);
  if (!v || !/^[a-z0-9]{1,40}$/i.test(v)) throw new AppError(400, 'Ongeldige id.');
  return v;
}
