'use server';

/**
 * Server Actions สำหรับ Authentication
 *
 * Post-migration: ไม่ต่อ pg ตรงแล้ว → เรียก smlnesservice (HTTPS)
 *   loginUser    → POST /api/v1/auth/login            (Bearer = SMLNES_CLIENT_TOKEN)
 *   selectDb     → POST /api/v1/auth/select-database  (Bearer = preSelectJWT)
 */

import {
  apiPost,
  ApiCallError,
  ApiTransportError,
  getClientToken,
} from '@/lib/api-client';
import { getPreSelectToken } from '@/lib/auth-server';
import {
  createSession,
  updateSessionWithDatabase,
  type DatabaseOption,
  type SessionUser,
} from './session';

// ──────────────────────────── Types ────────────────────────────

export interface LoginResult {
  success: boolean;
  message: string;
  user?: {
    user_code: string;
    user_name: string;
    user_level: number;
  };
  databases?: DatabaseOption[];
  /** true = ต้องไปหน้า /select-database (มี > 0 DBs); false = ไม่มี DB (no-op) */
  needSelectDatabase?: boolean;
  /** สิทธิ์เมนู "สินค้า/วัตถุดิบ คงเหลือยกมา" (menu_ic_stk_balance) */
  canStockBalance?: boolean;
}

export interface SelectDatabaseResult {
  success: boolean;
  message: string;
}

// ──────────────────────────── smlnesservice response shapes ────────────────────────────

interface SmlnesUserInfo {
  userCode: string;
  userName: string;
  userLevel: number;
}

interface SmlnesDatabaseInfo {
  dataCode: string;
  databaseName: string;
  dataName: string;
}

interface LoginResponse {
  preSelectToken: string;
  preSelectExpiresIn: number;
  user: SmlnesUserInfo;
  databases: SmlnesDatabaseInfo[];
  /** smlnesservice ≥ 0.6.0 — สิทธิ์เมนูย่อยของ client stock-adjust */
  permissions?: { canStockBalance: boolean };
}

interface SelectDatabaseResponse {
  accessToken: string;
  expiresIn: number;
  user: SmlnesUserInfo;
  database: SmlnesDatabaseInfo;
}

// ──────────────────────────── Validation ────────────────────────────

function validateLoginInput(
  provider: string,
  username: string,
  password: string,
): string | null {
  if (!provider || typeof provider !== 'string') return 'กรุณาระบุ Provider';
  if (!username || typeof username !== 'string') return 'กรุณาระบุ Username';
  if (!password || typeof password !== 'string') return 'กรุณาระบุ Password';
  if (!/^[a-zA-Z0-9]+$/.test(provider) || provider.length > 20) {
    return 'Provider ไม่ถูกต้อง';
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username) || username.length > 50) {
    return 'Username ไม่ถูกต้อง';
  }
  return null;
}

// ──────────────────────────── Actions ────────────────────────────

/**
 * Login + เก็บ preSelectJWT + databases ใน cookie
 * Caller (page) จะ redirect ไป /select-database ถ้า needSelectDatabase=true
 */
export async function loginUser(
  provider: string,
  dataGroup: string,
  username: string,
  password: string,
): Promise<LoginResult> {
  const validationError = validateLoginInput(provider, username, password);
  if (validationError) {
    return { success: false, message: validationError };
  }

  let response: LoginResponse;
  try {
    response = await apiPost<LoginResponse>('/api/v1/auth/login', getClientToken(), {
      provider,
      username,
      password,
      dataGroup: dataGroup || undefined,
    });
  } catch (err) {
    return { success: false, message: mapApiError(err) };
  }

  // map smlnesservice shape → cookie/UI shape
  const user: SessionUser = {
    user_code: response.user.userCode,
    user_name: response.user.userName,
    user_level: response.user.userLevel,
    provider,
    data_group: dataGroup || 'SML',
  };
  const databases: DatabaseOption[] = response.databases.map((d) => ({
    code: d.dataCode,
    database_name: d.databaseName,
    name: d.dataName,
  }));

  const sessionResult = await createSession(user, databases, response.preSelectToken);
  if (!sessionResult.success) {
    return { success: false, message: 'ไม่สามารถสร้าง session ได้' };
  }

  return {
    success: true,
    message: 'เข้าสู่ระบบสำเร็จ',
    user: {
      user_code: user.user_code,
      user_name: user.user_name,
      user_level: user.user_level,
    },
    databases,
    needSelectDatabase: databases.length > 0,
    canStockBalance: response.permissions?.canStockBalance ?? false,
  };
}

/**
 * เลือก database — แลก preSelectJWT → sessionJWT
 */
export async function selectDatabase(
  databaseName: string,
): Promise<SelectDatabaseResult> {
  if (!databaseName || typeof databaseName !== 'string') {
    return { success: false, message: 'กรุณาระบุ database' };
  }

  const preSelectJWT = await getPreSelectToken();
  if (!preSelectJWT) {
    return {
      success: false,
      message: 'Session หมดอายุ — กรุณา login ใหม่',
    };
  }

  let response: SelectDatabaseResponse;
  try {
    response = await apiPost<SelectDatabaseResponse>(
      '/api/v1/auth/select-database',
      preSelectJWT,
      { dataCode: databaseName },
    );
  } catch (err) {
    return { success: false, message: mapApiError(err) };
  }

  const result = await updateSessionWithDatabase(
    response.database.dataCode,
    response.database.databaseName,
    response.accessToken,
  );
  if (!result.success) {
    return { success: false, message: result.error || 'ไม่สามารถอัพเดท session ได้' };
  }

  return { success: true, message: 'เลือก database สำเร็จ' };
}

// ──────────────────────────── Helpers ────────────────────────────

function mapApiError(err: unknown): string {
  if (err instanceof ApiCallError) {
    switch (err.code) {
      case 'INVALID_API_KEY':
        return 'ระบบไม่ได้รับอนุญาตเรียก service — ติดต่อ admin';
      case 'INVALID_CREDENTIALS':
        return 'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
      case 'NO_PERMISSION':
        return 'ไม่มีสิทธิ์เข้าใช้งานระบบ (ต้องมีสิทธิ์เมนู "ปรับปรุงสินค้า/วัตถุดิบ")';
      case 'PROVIDER_NOT_FOUND':
        return 'ไม่พบ Provider ที่ระบุ';
      case 'DATABASE_NOT_FOUND':
        return 'ไม่พบ database หรือไม่มีสิทธิ์เข้าถึง';
      case 'TOKEN_EXPIRED':
      case 'UNAUTHORIZED':
        return 'Session หมดอายุ — กรุณา login ใหม่';
      default:
        return err.message || 'เกิดข้อผิดพลาดในระบบ';
    }
  }
  if (err instanceof ApiTransportError) {
    return 'เชื่อมต่อ smlnesservice ไม่ได้ — ติดต่อ admin';
  }
  if (err instanceof Error) return err.message;
  return 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}
