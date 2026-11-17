/** Fout met een melding die zo naar de gebruiker mag, plus een HTTP-status. */
export class AppError extends Error {
  constructor(public status: number, message: string, public code = 'error', public detail?: unknown) {
    super(message);
  }
}

export const badRequest = (msg: string, code = 'bad_request') => new AppError(400, msg, code);
export const notFound = (what: string) => new AppError(404, `${what} niet gevonden.`, 'not_found');
