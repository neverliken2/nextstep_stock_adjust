/**
 * Database Configuration
 * อ่านค่าจาก Environment Variables
 */

export const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  namePrefix: process.env.DB_NAME_PREFIX || 'smlerpmain',
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000', 10),
};

/**
 * สร้าง Database Name จาก provider
 */
export function getDatabaseName(provider: string): string {
  return `${dbConfig.namePrefix}${provider.toLowerCase()}`;
}

/**
 * สร้าง Pool Config สำหรับ pg
 */
export function getPoolConfig(provider: string) {
  return {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: getDatabaseName(provider),
    connectionTimeoutMillis: dbConfig.connectionTimeoutMillis,
  };
}

/**
 * สร้าง Pool Config สำหรับ database เฉพาะ
 */
export function getPoolConfigForDatabase(databaseName: string) {
  return {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: databaseName,
    connectionTimeoutMillis: dbConfig.connectionTimeoutMillis,
  };
}
