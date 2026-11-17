export type Role = 'owner' | 'admin' | 'member' | 'viewer';
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
export const atLeast = (role: Role | null | undefined, min: Role) => !!role && RANK[role] >= RANK[min];
export const ROLE_LABELS: Record<Role, string> = { owner: 'Eigenaar', admin: 'Beheerder', member: 'Lid', viewer: 'Kijker' };
export const ROLE_HINTS: Record<Role, string> = {
  owner: 'Alles, inclusief abonnement en werkruimte verwijderen',
  admin: 'Leden beheren en alle projecten bewerken',
  member: 'Projecten, mockups en generaties maken en bewerken',
  viewer: 'Alleen bekijken en downloaden',
};
