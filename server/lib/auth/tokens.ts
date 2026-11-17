import { createHash, randomBytes } from 'node:crypto';
/** Willekeurige token voor in een cookie of link; in de database staat alleen de hash. */
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
