/**
 * Server-side Authentication Helpers
 * ใช้ตรวจสอบ session และ validate input ใน Server Actions
 */

import { cookies } from 'next/headers';
import {
  SESSION_COOKIE_NAME,
  SESSION_IDLE_TIMEOUT_MS,
  getCookieOptions,
} from './cookie-options';
import { decodeSession, encodeSession } from './session-codec';

// ==================== Types ====================

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
  user: SessionUser;
  lastActivity: number;
  availableDatabases: string[];
}

// ==================== Session Validation ====================

/**
 * ตรวจสอบ session จาก cookie
 * ใช้ใน Server Actions เพื่อยืนยันว่า user login แล้ว
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

    // Sliding session — ผู้ใช้ active → ขยายอายุ session อัตโนมัติ
    sessionData.lastActivity = Date.now();
    const refreshed = encodeSession(sessionData);
    cookieStore.set(SESSION_COOKIE_NAME, refreshed, getCookieOptions());

    return {
      authenticated: true,
      user: sessionData.user as SessionUser,
    };
  } catch (error) {
    console.error('Session validation error:', error);
    return { authenticated: false, error: 'Invalid session' };
  }
}

/**
 * ตรวจสอบว่า user มีสิทธิ์เข้าถึง database นี้หรือไม่
 */
export async function validateDatabaseAccess(database: string): Promise<AuthResult> {
  const session = await validateSession();
  
  if (!session.authenticated) {
    return session;
  }

  // ตรวจสอบว่า database ที่ request ตรงกับ selected_database หรือไม่
  if (session.user?.selected_database !== database) {
    return { 
      authenticated: false, 
      error: 'Access denied: Invalid database' 
    };
  }

  return session;
}

// ==================== Input Validation ====================

/**
 * Validate และ sanitize database name
 * ป้องกัน SQL injection และ path traversal
 */
export function validateDatabaseName(name: string): { valid: boolean; sanitized: string; error?: string } {
  if (!name || typeof name !== 'string') {
    return { valid: false, sanitized: '', error: 'Database name is required' };
  }

  // ต้องขึ้นต้นด้วย smlerp (ตาม pattern ของระบบ)
  // อนุญาตเฉพาะ a-z, 0-9, underscore
  const sanitized = name.toLowerCase().trim();
  const validPattern = /^smlerp[a-z0-9_]+$/;

  if (!validPattern.test(sanitized)) {
    return { valid: false, sanitized: '', error: 'Invalid database name format' };
  }

  // Maximum length
  if (sanitized.length > 50) {
    return { valid: false, sanitized: '', error: 'Database name too long' };
  }

  return { valid: true, sanitized };
}

/**
 * Validate date format (YYYY-MM-DD)
 */
export function validateDate(dateStr: string): { valid: boolean; date: Date | null; error?: string } {
  if (!dateStr || typeof dateStr !== 'string') {
    return { valid: false, date: null, error: 'Date is required' };
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(dateStr)) {
    return { valid: false, date: null, error: 'Invalid date format (expected YYYY-MM-DD)' };
  }

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return { valid: false, date: null, error: 'Invalid date value' };
  }

  return { valid: true, date };
}

/**
 * Validate page number
 */
export function validatePage(page: number): number {
  const num = Math.floor(Number(page));
  if (isNaN(num) || num < 1) return 1;
  if (num > 10000) return 10000; // Max page limit
  return num;
}

/**
 * Validate page size
 */
export function validatePageSize(pageSize: number): number {
  const num = Math.floor(Number(pageSize));
  if (isNaN(num) || num < 1) return 20;
  if (num > 100) return 100; // Max 100 records per page
  return num;
}

/**
 * Validate limit for search results
 */
export function validateLimit(limit: number): number {
  const num = Math.floor(Number(limit));
  if (isNaN(num) || num < 1) return 20;
  if (num > 100) return 100;
  return num;
}

/**
 * Sanitize search text
 * ลบ special characters ที่อาจเป็นอันตราย
 */
export function sanitizeSearchText(text: string): string {
  if (!text || typeof text !== 'string') return '';
  
  // Remove potential SQL injection patterns
  // แต่ยังให้ใช้ภาษาไทยและ alphanumeric ได้
  return text
    .trim()
    .slice(0, 100) // Max 100 chars
    .replace(/[;'"\\]/g, ''); // Remove dangerous chars
}

/**
 * Validate product code
 */
export function validateProductCode(code: string): string {
  if (!code || typeof code !== 'string') return '';
  
  // Product code: alphanumeric, dash, underscore only
  return code
    .trim()
    .slice(0, 50)
    .replace(/[^a-zA-Z0-9\-_]/g, '');
}
