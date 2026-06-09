/**
 * Cookie configuration shared between server actions (session.ts)
 * and server-side helpers (auth-server.ts).
 *
 * Kept in a non-'use server' file so synchronous helpers can be
 * exported and used outside of Server Actions.
 */

export const SESSION_COOKIE_NAME = 'nextstep_ia_session';

export function getCookieOptions() {
  const forceInsecure = process.env.COOKIE_SECURE === 'false';
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure: isProduction && !forceInsecure,
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24, // 1 day absolute (cookie hard expiry)
    path: '/',
  };
}

/** Sliding session window — extend whenever user is active */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
