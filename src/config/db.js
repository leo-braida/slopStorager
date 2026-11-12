import pg from "pg";

const { Pool } = pg;

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@postgres:5432/slopstorager";

let pool = null;

const INIT_DDL = `
CREATE TABLE IF NOT EXISTS packages (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  hallucination_counts INTEGER NOT NULL DEFAULT 1 CHECK (hallucination_counts >= 0),
  first_date TIMESTAMPTZ NOT NULL,
  last_date TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_packages_hallucination_counts
  ON packages (hallucination_counts DESC, name ASC);

CREATE INDEX IF NOT EXISTS idx_packages_last_date
  ON packages (last_date);

CREATE TABLE IF NOT EXISTS schemas (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  format VARCHAR(10) NOT NULL CHECK (format IN ('CSV', 'JSON')),
  schema JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

/**
 * Connects to PostgreSQL with retry logic and initializes the database schema.
 * @param {number} [retries=15]
 * @param {number} [delayMs=2000]
 * @returns {Promise<import('pg').Pool>}
 */
export async function connectDB(retries = 15, delayMs = 2000) {
  if (pool) return pool;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const candidatePool = new Pool({ connectionString: DATABASE_URL });
    try {
      const client = await candidatePool.connect();
      try {
        await client.query(INIT_DDL);
      } finally {
        client.release();
      }
      pool = candidatePool;
      console.log(`Connected to PostgreSQL and verified schema tables.`);
      return pool;
    } catch (err) {
      await candidatePool.end().catch(() => {});
      console.warn(
        `PostgreSQL connection attempt ${attempt}/${retries} failed: ${err.message}`,
      );
      if (attempt === retries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Returns the initialized PostgreSQL connection pool.
 * @returns {import('pg').Pool}
 */
export function getPool() {
  if (!pool) {
    throw new Error("Database not initialized. Call connectDB() first.");
  }
  return pool;
}

/**
 * Executes a parameterized SQL query on the pool.
 * @param {string} text
 * @param {unknown[]} [params]
 * @returns {Promise<import('pg').QueryResult>}
 */
export function query(text, params) {
  return getPool().query(text, params);
}

/**
 * Closes the PostgreSQL connection pool.
 */
export async function closeDB() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
