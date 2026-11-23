export const ADMIN_EMAIL: string = import.meta.env.VITE_ADMIN_EMAIL ?? '';

/** Matches the rules: the admin is a verified account with the fixed admin email. */
export function isAdminUser(user: { email: string | null; emailVerified: boolean } | null | undefined): boolean {
  return !!user && user.emailVerified && !!ADMIN_EMAIL && user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
