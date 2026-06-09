/**
 * Database Connection Pool Singleton
 * ใช้ pool เดียวกันตลอด lifecycle ของ application
 * ไม่ต้องเปิด-ปิดทุกครั้ง
 * 
 * 🛡️ Protection Features:
 * - Query Timeout: ป้องกัน query ค้าง
 * - Statement Timeout: PostgreSQL จะ cancel query อัตโนมัติ
 * - Connection Timeout: ไม่รอ connection นานเกินไป
 * - Error Handling: จับ error ไม่ให้ crash
 */

import { Pool, PoolClient } from 'pg';
import { dbConfig } from './database';

// Cache pools by database name
const pools: Map<string, Pool> = new Map();

// ==================== Timeout Configuration ====================

const TIMEOUTS = {
  CONNECTION: 30000,      // 30 วินาที - รอ connection (เพิ่มจาก 10 วิ เพราะ remote server)
  QUERY_DEFAULT: 30000,   // 30 วินาที - query ปกติ
  QUERY_REPORT: 60000,    // 60 วินาที - query รายงาน
  QUERY_MAX: 120000,      // 2 นาที - query ใหญ่มาก (export)
  IDLE: 60000,            // 60 วินาที - ปิด idle connection (เพิ่มจาก 30 วิ)
};

export { TIMEOUTS };

// ==================== Query Options ====================

export interface QueryOptions {
  timeout?: number;       // Query timeout in milliseconds
  isReport?: boolean;     // ถ้าเป็น report จะใช้ timeout นานขึ้น
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

// ==================== Pool Management ====================

/**
 * Get or create a connection pool for a specific database
 * Pool จะถูก reuse ไม่สร้างใหม่ทุกครั้ง
 */
export function getPool(databaseName: string): Pool {
  // PostgreSQL database names are case-sensitive, convert to lowercase
  const dbName = databaseName.toLowerCase();
  let pool = pools.get(dbName);
  
  if (!pool) {
    pool = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbName,
      // Connection pool settings
      max: 10,                                    // Maximum connections in pool
      min: 1,                                     // Minimum connections to keep (ลดจาก 2)
      idleTimeoutMillis: TIMEOUTS.IDLE,           // Close idle connections
      connectionTimeoutMillis: TIMEOUTS.CONNECTION, // Connection timeout
      statement_timeout: TIMEOUTS.QUERY_DEFAULT,  // PostgreSQL statement timeout
      query_timeout: TIMEOUTS.QUERY_DEFAULT,      // pg query timeout
      // Keep-alive settings for remote server
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,         // 10 วินาที
    });
    
    // Handle pool errors - ป้องกัน crash
    pool.on('error', (err) => {
      console.error(`[DB Pool Error] ${dbName}:`, err.message);
      // ไม่ throw - ให้ pool ทำงานต่อได้
    });

    pool.on('connect', () => {
      console.log(`[DB] New connection to: ${dbName}`);
    });
    
    pools.set(dbName, pool);
    console.log(`[DB] Created pool for: ${dbName}`);
  }
  
  return pool;
}

/**
 * Get pool for login database (smlerpmain + provider)
 */
export function getLoginPool(provider: string): Pool {
  const databaseName = `${dbConfig.namePrefix}${provider.toLowerCase()}`;
  return getPool(databaseName);
}

// ==================== Safe Query Functions ====================

/**
 * Execute a query with timeout protection
 * ป้องกัน server hang จาก query ที่ใช้เวลานาน
 * databaseName = ชื่อ database เต็ม (เช่น 'smlerpmain', 'smlerpmainDemo')
 */
export async function safeQuery<T = Record<string, unknown>>(
  databaseName: string,
  sql: string,
  params?: (string | number | boolean | null)[],
  options: QueryOptions = {}
): Promise<QueryResult<T>> {
  // ใช้ getPool ตรงๆ - ต้องส่งชื่อ database เต็มมา
  const pool = getPool(databaseName);
  
  // กำหนด timeout ตาม options
  let timeout = options.timeout || TIMEOUTS.QUERY_DEFAULT;
  if (options.isReport && !options.timeout) {
    timeout = TIMEOUTS.QUERY_REPORT;
  }
  timeout = Math.min(timeout, TIMEOUTS.QUERY_MAX); // ไม่เกิน max
  
  const client = await pool.connect();
  let timeoutId: NodeJS.Timeout | undefined;
  
  try {
    // Set statement timeout สำหรับ query นี้
    await client.query(`SET statement_timeout = ${timeout}`);
    
    // สร้าง timeout promise เป็น backup
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new QueryTimeoutError(timeout));
      }, timeout + 2000); // เผื่อเวลาเล็กน้อย
    });
    
    // รัน query พร้อม timeout race
    const queryPromise = client.query(sql, params);
    const result = await Promise.race([queryPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    
    return {
      rows: result.rows as T[],
      rowCount: result.rowCount || 0
    };
    
  } catch (error) {
    // พยายาม cancel query ถ้ายัง running
    try {
      await client.query('SELECT pg_cancel_backend(pg_backend_pid())');
    } catch {
      // Ignore cancel errors
    }
    
    // Re-throw with better message
    if (error instanceof QueryTimeoutError) {
      throw error;
    }
    throw error;
    
  } finally {
    // Clear the backup timer when the database-side timeout wins first.
    if (typeof timeoutId !== 'undefined') clearTimeout(timeoutId);
    // Reset timeout และ release connection
    try {
      await client.query('RESET statement_timeout');
    } catch {
      // Ignore reset errors
    }
    client.release();
  }
}

/**
 * Execute a query (backwards compatible)
 * ใช้ safeQuery internally
 */
export async function query<T = Record<string, unknown>>(
  databaseName: string,
  sql: string,
  params?: (string | number | boolean | null)[]
): Promise<T[]> {
  const result = await safeQuery<T>(databaseName, sql, params);
  return result.rows;
}

/**
 * Execute query with client (for transactions or multiple queries)
 * มี timeout protection
 */
export async function safeQueryWithClient<T = Record<string, unknown>>(
  client: PoolClient,
  sql: string,
  params?: (string | number | boolean | null)[],
  timeout: number = TIMEOUTS.QUERY_DEFAULT
): Promise<QueryResult<T>> {
  // Set statement timeout
  await client.query(`SET statement_timeout = ${Math.min(timeout, TIMEOUTS.QUERY_MAX)}`);
  
  try {
    const result = await client.query(sql, params);
    return {
      rows: result.rows as T[],
      rowCount: result.rowCount || 0
    };
  } finally {
    await client.query('RESET statement_timeout');
  }
}

// ==================== Transaction Support ====================

/**
 * Execute multiple queries in a transaction with timeout
 */
export async function transaction<T>(
  databaseName: string,
  callback: (client: PoolClient) => Promise<T>,
  timeout: number = TIMEOUTS.QUERY_REPORT
): Promise<T> {
  const pool = getPool(databaseName);
  const client = await pool.connect();
  
  try {
    await client.query(`SET statement_timeout = ${timeout}`);
    await client.query('BEGIN');
    
    const result = await callback(client);
    
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    try {
      await client.query('RESET statement_timeout');
    } catch {
      // Ignore
    }
    client.release();
  }
}

// ==================== Health Check ====================

/**
 * Check database health
 */
export async function checkDatabaseHealth(databaseName: string): Promise<{
  healthy: boolean;
  latencyMs: number;
  poolSize?: number;
  error?: string;
}> {
  const start = Date.now();
  
  try {
    const pool = getPool(databaseName);
    const result = await safeQuery(databaseName, 'SELECT 1 as ok', [], { timeout: 5000 });
    
    return {
      healthy: result.rows.length > 0,
      latencyMs: Date.now() - start,
      poolSize: pool.totalCount,
    };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// ==================== Cleanup ====================

/**
 * Cleanup all pools (สำหรับ graceful shutdown)
 */
export async function closeAllPools(): Promise<void> {
  console.log('[DB] Closing all pools...');
  
  const closePromises = Array.from(pools.entries()).map(async ([dbName, pool]) => {
    try {
      await pool.end();
      console.log(`[DB] Pool closed: ${dbName}`);
    } catch (error) {
      console.error(`[DB] Error closing pool ${dbName}:`, error);
    }
  });
  
  await Promise.all(closePromises);
  pools.clear();
  console.log('[DB] All pools closed');
}

// ==================== Custom Errors ====================

export class QueryTimeoutError extends Error {
  public readonly timeoutMs: number;
  
  constructor(timeoutMs: number) {
    super(`Query timeout หลังจาก ${timeoutMs / 1000} วินาที - กรุณาลดช่วงวันที่หรือเพิ่มเงื่อนไขการค้นหา`);
    this.name = 'QueryTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class DatabaseConnectionError extends Error {
  constructor(database: string, originalError?: Error) {
    super(`ไม่สามารถเชื่อมต่อฐานข้อมูล ${database} ได้${originalError ? `: ${originalError.message}` : ''}`);
    this.name = 'DatabaseConnectionError';
  }
}

// ==================== Graceful Shutdown Setup ====================

let isShuttingDown = false;

export function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`\n[Shutdown] Received ${signal}, closing database connections...`);
    
    try {
      await closeAllPools();
      process.exit(0);
    } catch (error) {
      console.error('[Shutdown] Error:', error);
      process.exit(1);
    }
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
