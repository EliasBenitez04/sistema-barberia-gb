const { Pool } = require('pg');

const useSsl = String(process.env.DB_SSL || 'false').toLowerCase() === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000
});

pool.on('error', (error) => {
  console.error('Error inesperado de PostgreSQL:', error);
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
