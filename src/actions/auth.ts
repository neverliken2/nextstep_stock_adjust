'use server';

/**
 * Server Actions สำหรับ Authentication
 * Login โดยตรง ไม่ผ่าน API route
 */

import { getLoginPool } from '@/lib/db';
import { createSession } from './session';

// ==================== Types ====================

export interface LoginResult {
  success: boolean;
  message: string;
  user?: {
    user_code: string;
    user_name: string;
    user_level: number;
  };
  databases?: {
    code: string;
    database_name: string;
    name: string;
  }[];
}

// ==================== Validation ====================

function validateLoginInput(provider: string, username: string, password: string): string | null {
  if (!provider || typeof provider !== 'string') {
    return 'กรุณาระบุ Provider';
  }
  if (!username || typeof username !== 'string') {
    return 'กรุณาระบุ Username';
  }
  if (!password || typeof password !== 'string') {
    return 'กรุณาระบุ Password';
  }
  
  // Provider: alphanumeric only, max 20 chars
  if (!/^[a-zA-Z0-9]+$/.test(provider) || provider.length > 20) {
    return 'Provider ไม่ถูกต้อง';
  }
  
  // Username: alphanumeric and underscore, max 50 chars
  if (!/^[a-zA-Z0-9_]+$/.test(username) || username.length > 50) {
    return 'Username ไม่ถูกต้อง';
  }
  
  return null;
}

// ==================== Actions ====================

/**
 * Login และสร้าง session
 */
export async function loginUser(
  provider: string,
  dataGroup: string,
  username: string,
  password: string
): Promise<LoginResult> {
  // Validate input
  const validationError = validateLoginInput(provider, username, password);
  if (validationError) {
    return { success: false, message: validationError };
  }

  try {
    // Get connection from pool
    const pool = getLoginPool(provider);
    const client = await pool.connect();

    try {
      // Query user from sml_user_list table
      const userResult = await client.query(
        `SELECT user_code, user_name, user_password, user_level 
         FROM sml_user_list 
         WHERE UPPER(user_code) = UPPER($1)`,
        [username]
      );

      if (userResult.rows.length === 0) {
        return { success: false, message: 'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
      }

      const user = userResult.rows[0];

      // Check password
      if (user.user_password !== password) {
        return { success: false, message: 'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
      }

      // Get available databases for user
      const effectiveDataGroup = dataGroup || 'SML';
      const databaseResult = await client.query(
        `SELECT data_code as code, data_database_name as database_name, data_name as name 
         FROM sml_database_list 
         WHERE UPPER(data_group) = UPPER($1) 
           AND UPPER(data_code) IN (
             SELECT UPPER(data_code) FROM sml_database_list_user_and_group 
             WHERE UPPER(user_or_group_code) = UPPER($2)
           )`,
        [effectiveDataGroup, username]
      );

      const userData = {
        user_code: user.user_code,
        user_name: user.user_name,
        user_level: user.user_level || 0,
        provider,
        data_group: effectiveDataGroup,
      };

      // ใช้ database_name ตามที่เก็บใน sml_database_list (ไม่ต้องเพิ่ม prefix)
      const databases = databaseResult.rows;

      // สร้าง secure session cookie
      const sessionResult = await createSession(userData, databases);
      if (!sessionResult.success) {
        return { success: false, message: 'ไม่สามารถสร้าง session ได้' };
      }

      return {
        success: true,
        message: 'เข้าสู่ระบบสำเร็จ',
        user: {
          user_code: user.user_code,
          user_name: user.user_name,
          user_level: user.user_level || 0,
        },
        databases,
      };
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    console.error('Login error:', error);

    const dbError = error as { code?: string };

    if (dbError.code === '3D000') {
      return { success: false, message: 'ไม่พบ Provider ที่ระบุ' };
    }

    if (dbError.code === '42P01') {
      return { success: false, message: 'ไม่พบตารางผู้ใช้งานในระบบ' };
    }

    if (dbError.code === 'ECONNREFUSED' || dbError.code === 'ETIMEDOUT') {
      return { success: false, message: 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้' };
    }

    return { success: false, message: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่' };
  }
}
