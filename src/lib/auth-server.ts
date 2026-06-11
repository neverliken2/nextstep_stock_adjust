/**
 * Server-side Authentication Helpers
 *
 * Post-migration: ดึง JWT (preSelect | session) จาก cookie + user info ที่ cache ไว้
 * - Server actions ใช้ getSessionToken() เพื่อเอา bearer ไปยิง smlnesservice
 * - validateSession() ตรวจ idle timeout + sliding refresh
 *
 * Pattern: mirror จาก NextStep_CN_Coupon (เพื่อ consistent ระหว่าง 2 web apps)
 */

import { cookies } from 'next/headers';
import {
  SESSION_COOKIE_NAME,
  SESSION_IDLE_TIMEOUT_MS,
  getCookieOptions,
} from './cookie-options';
import { decodeSession, encodeSession } from './session-codec';

// ──────────────────────────── Types ────────────────────────────

export interface SessionUser {
  user_code: string;
  user_name: string;
  user_level: number;
  provider: string;
  data_group: string;
  selected_database?: string;
  selected_database_name?: string;
}

export interface AuthResult {
  authenticated: boolean;
  user?: SessionUser;
  error?: string;
}

interface SessionData {
  preSelectJWT?: string;
  sessionJWT?: string;
  user: SessionUser;
  availableDatabases: { code: string; database_name: string; name: string }[];
  lastActivity: number;
}

// ──────────────────────────── Session Validation ────────────────────────────

/**
 * ตรวจสอบ session — idle timeout + sliding refresh
 *
 * NOTE: ไม่ตรวจ JWT exp ที่นี่ — smlnesservice จะ reject 401 ถ้า JWT expired
 *       (เราใช้ idle timeout ของ cookie เป็น UX layer แรก)
 */
export async function validateSession(): Promise<AuthResult> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
    if (!sessionCookie?.value) {
      return { authenticated: false, error: 'Session not found' };
    }

    const sessionData = decodeSession<SessionData>(sessionCookie.value);

    const ageMs = Date.now() - sessionData.lastActivity;
    if (ageMs > SESSION_IDLE_TIMEOUT_MS) {
      return { authenticated: false, error: 'Session expired' };
    }

    // Sliding session — extend อายุทุกครั้งที่ active
    sessionData.lastActivity = Date.now();
    cookieStore.set(
      SESSION_COOKIE_NAME,
      encodeSession(sessionData),
      getCookieOptions(),
    );

    return { authenticated: true, user: sessionData.user };
  } catch (error) {
    console.error('Session validation error:', error);
    return { authenticated: false, error: 'Invalid session' };
  }
}

/**
 * ดึง session JWT (สำหรับเรียก smlnesservice protected endpoints)
 * Return null ถ้า session ไม่มี/หมดอายุ/ยังไม่ select-database
 */
export async function getSessionToken(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
    if (!sessionCookie?.value) return null;

    const sessionData = decodeSession<SessionData>(sessionCookie.value);
    const ageMs = Date.now() - sessionData.lastActivity;
    if (ageMs > SESSION_IDLE_TIMEOUT_MS) return null;

    return sessionData.sessionJWT || null;
  } catch {
    return null;
  }
}

/**
 * ดึง pre-select JWT (สำหรับ /auth/select-database)
 */
export async function getPreSelectToken(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
    if (!sessionCookie?.value) return null;

    const sessionData = decodeSession<SessionData>(sessionCookie.value);
    const ageMs = Date.now() - sessionData.lastActivity;
    if (ageMs > SESSION_IDLE_TIMEOUT_MS) return null;

    return sessionData.preSelectJWT || null;
  } catch {
    return null;
  }
}

/**
 * Helper สำหรับ actions — return tenant context พร้อม JWT
 * { sessionJWT, user } หรือ { error }
 */
export async function requireSessionContext(): Promise<
  | { sessionJWT: string; user: SessionUser }
  | { error: string }
> {
  const session = await validateSession();
  if (!session.authenticated || !session.user) {
    return { error: session.error || 'Session expired - กรุณา login ใหม่' };
  }
  const sessionJWT = await getSessionToken();
  if (!sessionJWT) {
    return { error: 'ยังไม่ได้เลือก database' };
  }
  return { sessionJWT, user: session.user };
}

// ──────────────────────────── Input Validation (เก็บไว้ — ใช้ใน components) ────────────────────────────

export function validateDatabaseName(name: string): {
  valid: boolean;
  sanitized: string;
  error?: string;
} {
  if (!name || typeof name !== 'string') {
    return { valid: false, sanitized: '', error: 'Database name is required' };
  }
  const sanitized = name.toLowerCase().trim();
  const validPattern = /^smlerp[a-z0-9_]+$/;
  if (!validPattern.test(sanitized)) {
    return { valid: false, sanitized: '', error: 'Invalid database name format' };
  }
  if (sanitized.length > 50) {
    return { valid: false, sanitized: '', error: 'Database name too long' };
  }
  return { valid: true, sanitized };
}

export function validateDate(dateStr: string): {
  valid: boolean;
  date: Date | null;
  error?: string;
} {
  if (!dateStr || typeof dateStr !== 'string') {
    return { valid: false, date: null, error: 'Date is required' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return {
      valid: false,
      date: null,
      error: 'Invalid date format (expected YYYY-MM-DD)',
    };
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return { valid: false, date: null, error: 'Invalid date value' };
  }
  return { valid: true, date };
}

export function validatePage(page: number): number {
  const num = Math.floor(Number(page));
  if (isNaN(num) || num < 1) return 1;
  if (num > 10000) return 10000;
  return num;
}

export function validatePageSize(pageSize: number): number {
  const num = Math.floor(Number(pageSize));
  if (isNaN(num) || num < 1) return 20;
  if (num > 100) return 100;
  return num;
}

export function validateLimit(limit: number): number {
  const num = Math.floor(Number(limit));
  if (isNaN(num) || num < 1) return 20;
  if (num > 100) return 100;
  return num;
}

export function sanitizeSearchText(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text.trim().slice(0, 100).replace(/[;'"\\]/g, '');
}

export function validateProductCode(code: string): string {
  if (!code || typeof code !== 'string') return '';
  return code.trim().slice(0, 50).replace(/[^a-zA-Z0-9\-_]/g, '');
}
