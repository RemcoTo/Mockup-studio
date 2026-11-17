import { randomUUID } from 'node:crypto';
export const newId = () => randomUUID().replace(/-/g, '').slice(0, 20);
export const now = () => new Date().toISOString();
