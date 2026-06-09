'use server';

/**
 * Server Actions สำหรับ Session Management
 * ใช้จัดการ session cookie ที่ secure
 */

import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, getCookieOptions } from '@/lib/cookie-options';
import { decodeSession, encodeSession } from '@/lib/session-codec';

interface SessionData {
  user: {
    user_code: string;
    user_name: string;
    user_level: number;
    provider: string;
    data_group: string;
    selected_database?: string;
    selected_database_name?: string;
  };
  lastActivity: number;
  availableDatabases: string[];
}

/**
 * สร้าง session หลัง login สำเร็จ
 */
export async function createSession(
  user: SessionData['user'],
  availableDatabases: { code: string; database_name: string; name: string }[]
): Promise<{ success: boolean }> {
  try {
    const sessionData: SessionData = {
      user,
      lastActivity: Date.now(),
      availableDatabases: availableDatabases.map((db) => db.database_name),
    };

    const sessionValue = encodeSession(sessionData);

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionValue, getCookieOptions());

    return { success: true };
  } catch (error) {
    console.error('Create session error:', error);
    return { success: false };
  }
}

/**
 * อัพเดท session เมื่อเลือก database
 */
export async function updateSessionDatabase(
  selectedDatabase: string,
  selectedDatabaseName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!sessionCookie?.value) {
      return { success: false, error: 'Session not found' };
    }

    const sessionData = decodeSession<SessionData>(sessionCookie.value);

    if (!sessionData.availableDatabases.includes(selectedDatabase)) {
      return { success: false, error: 'Access denied: Invalid database' };
    }

    sessionData.user.selected_database = selectedDatabase;
    sessionData.user.selected_database_name = selectedDatabaseName;
    sessionData.lastActivity = Date.now();

    const sessionValue = encodeSession(sessionData);
    cookieStore.set(SESSION_COOKIE_NAME, sessionValue, getCookieOptions());

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

    if (!sessionCookie?.value) {
      return { success: false };
    }

    const sessionData = decodeSession<SessionData>(sessionCookie.value);

    sessionData.lastActivity = Date.now();

    const sessionValue = encodeSession(sessionData);
    cookieStore.set(SESSION_COOKIE_NAME, sessionValue, getCookieOptions());

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
