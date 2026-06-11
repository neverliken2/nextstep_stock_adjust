'use server';

/**
 * Server Actions สำหรับ Session Management
 *
 * Cookie payload หลัง migrate ไป smlnesservice:
 * - หลัง /auth/login   → เก็บ preSelectJWT + user info + databases list
 * - หลัง /select-db    → เก็บ sessionJWT + selected database (clear preSelectJWT)
 *
 * ทั้งหมด HMAC-signed ผ่าน session-codec — server ไม่เก็บ state
 */

import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, getCookieOptions } from '@/lib/cookie-options';
import { decodeSession, encodeSession } from '@/lib/session-codec';

// ──────────────────────────── Types ────────────────────────────

export interface DatabaseOption {
  code: string;
  database_name: string;
  name: string;
}

export interface SessionUser {
  user_code: string;
  user_name: string;
  user_level: number;
  provider: string;
  data_group: string;
  selected_database?: string;
  selected_database_name?: string;
}

export interface SessionData {
  /** มีเฉพาะหลัง /auth/login ก่อน select-database */
  preSelectJWT?: string;
  /** มีเฉพาะหลัง /select-database */
  sessionJWT?: string;
  user: SessionUser;
  /** Cache databases list (ออกมาตอน /auth/login) — ใช้ใน /select-database page */
  availableDatabases: DatabaseOption[];
  /** epoch ms — sliding refresh ใน validateSession */
  lastActivity: number;
}

// ──────────────────────────── Create / Update ────────────────────────────

/**
 * เก็บ preSelectJWT + user + databases หลัง /auth/login สำเร็จ
 */
export async function createSession(
  user: SessionUser,
  availableDatabases: DatabaseOption[],
  preSelectJWT: string,
): Promise<{ success: boolean }> {
  try {
    const sessionData: SessionData = {
      preSelectJWT,
      user,
      availableDatabases,
      lastActivity: Date.now(),
    };

    const cookieStore = await cookies();
    cookieStore.set(
      SESSION_COOKIE_NAME,
      encodeSession(sessionData),
      getCookieOptions(),
    );

    return { success: true };
  } catch (error) {
    console.error('Create session error:', error);
    return { success: false };
  }
}

/**
 * Upgrade preSelect → session — เก็บ sessionJWT + selected database
 * (preSelectJWT จะถูก clear)
 */
export async function updateSessionWithDatabase(
  selectedDatabaseCode: string,
  selectedDatabaseName: string,
  sessionJWT: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!sessionCookie?.value) {
      return { success: false, error: 'Session not found' };
    }

    const sessionData = decodeSession<SessionData>(sessionCookie.value);

    // verify ว่า database อยู่ใน list ที่ user มีสิทธิ์ (defence-in-depth)
    const allowed = sessionData.availableDatabases.some(
      (db) =>
        db.code.toUpperCase() === selectedDatabaseCode.toUpperCase() ||
        db.database_name.toUpperCase() === selectedDatabaseCode.toUpperCase(),
    );
    if (!allowed) {
      return { success: false, error: 'Access denied: Invalid database' };
    }

    const next: SessionData = {
      sessionJWT,
      user: {
        ...sessionData.user,
        selected_database: selectedDatabaseName,
        selected_database_name: selectedDatabaseName,
      },
      availableDatabases: sessionData.availableDatabases,
      lastActivity: Date.now(),
    };

    cookieStore.set(
      SESSION_COOKIE_NAME,
      encodeSession(next),
      getCookieOptions(),
    );

    return { success: true };
  } catch (error) {
    console.error('Update session error:', error);
    return { success: false, error: 'Failed to update session' };
  }
}

/**
 * อัพเดท last activity timestamp (manual refresh from client if needed)
 */
export async function refreshSession(): Promise<{ success: boolean }> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
    if (!sessionCookie?.value) return { success: false };

    const sessionData = decodeSession<SessionData>(sessionCookie.value);
    sessionData.lastActivity = Date.now();
    cookieStore.set(
      SESSION_COOKIE_NAME,
      encodeSession(sessionData),
      getCookieOptions(),
    );

    return { success: true };
  } catch {
    return { success: false };
  }
}

/**
 * ลบ session (logout)
 */
export async function destroySession(): Promise<{ success: boolean }> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
    return { success: true };
  } catch {
    return { success: false };
  }
}
