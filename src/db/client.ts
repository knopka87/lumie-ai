import { Pool, PoolClient, QueryResult } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', err => {
  console.error('Unexpected error on idle client', err);
});

/**
 * Execute a query and return all rows
 */
export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows;
}

/**
 * Execute a query and return the first row or null
 */
export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

/**
 * Execute a query without returning rows (INSERT, UPDATE, DELETE)
 * Returns the result object with rowCount
 */
export async function execute(sql: string, params?: any[]): Promise<QueryResult> {
  return pool.query(sql, params);
}

/**
 * Get the last inserted ID from an INSERT ... RETURNING id query
 */
export async function insert(sql: string, params?: any[]): Promise<number | null> {
  const result = await pool.query(sql, params);
  return result.rows[0]?.id ?? null;
}

/**
 * Execute multiple statements in a transaction
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Close the pool (for graceful shutdown)
 */
export async function close(): Promise<void> {
  await pool.end();
}

export { pool };
