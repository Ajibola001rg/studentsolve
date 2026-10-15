const path = require('path');
// Ensure .env is loaded regardless of the directory node is executed from
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const rawConnectionString = process.env.DATABASE_URL || '';

if (!rawConnectionString) {
  console.error('[Database Error] DATABASE_URL is not set in your .env file.');
}

// Strip ?sslmode=... from connection string to prevent pg-connection-string from overriding rejectUnauthorized
const cleanConnectionString = rawConnectionString.replace(/([?&])sslmode=[^&]+(&|$)/, '$1').replace(/\?$/, '');

const pool = new Pool({
  connectionString: cleanConnectionString || undefined,
  ssl: cleanConnectionString ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// Prevent unhandled idle connection errors from crashing the Node process
pool.on('error', (err) => {
  console.error('[Database Pool Error]', err.message);
});

// Helper: Converts SQLite "?" placeholders to PostgreSQL "$1, $2, $3"
// Also normalizes double-quoted literal values (e.g., = "student" -> = 'student')
function formatSql(sql) {
  let index = 1;
  let formatted = sql.replace(/\?/g, () => `$${index++}`);
  // Replace double-quoted values following an assignment or comparison operator
  formatted = formatted.replace(/=\s*"([^"]+)"/g, " = '$1'");
  return formatted;
}

// Helper: Convert all undefined parameters to null for PostgreSQL compatibility
function sanitize(params = []) {
  return params.map((p) => (p === undefined ? null : p));
}

// 1. Initialize Tables in PostgreSQL
async function initDb() {
  if (!cleanConnectionString) return;

  let client;
  try {
    client = await pool.connect();

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        institution VARCHAR(255),
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'student',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(50) PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        service VARCHAR(255) NOT NULL,
        subject VARCHAR(255),
        deadline DATE NOT NULL,
        referencing VARCHAR(100),
        instructions TEXT NOT NULL,
        volume INTEGER DEFAULT 1,
        unit_title VARCHAR(100),
        amount INTEGER NOT NULL,
        status VARCHAR(100) DEFAULT 'Consultation Scheduled',
        stage INTEGER DEFAULT 0,
        specialist VARCHAR(255) DEFAULT 'StudentSolve Lead',
        payment_ref VARCHAR(255),
        paid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS project_files (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(50) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        size_bytes BIGINT NOT NULL,
        uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS project_messages (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(50) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        sender_role VARCHAR(50) NOT NULL,
        sender_name VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_messages_order_id ON project_messages(order_id);
    `);

    // 2. Seed Initial Admin Account
    const adminEmail = process.env.ADMIN_INITIAL_EMAIL || 'admin@studentsolve.ng';
    const existingAdmin = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail]);

    if (existingAdmin.rows.length === 0) {
      const defaultPassword = process.env.ADMIN_INITIAL_PASSWORD || 'AdminSecurePass2026!';
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(defaultPassword, salt);

      await client.query(
        `INSERT INTO users (full_name, email, institution, password_hash, role)
         VALUES ($1, $2, $3, $4, $5)`,
        ['System Administrator', adminEmail, 'StudentSolve Operations', hash, 'admin']
      );
      console.log(`[Database] Seeded initial admin account: ${adminEmail}`);
    }
  } catch (err) {
    console.error('[Database] Initialization error:', err.message);
  } finally {
    if (client) client.release();
  }
}

// Run schema initialization
initDb();

module.exports = {
  pool,

  // Fetch multiple rows
  query: async (sql, params = []) => {
    const formatted = formatSql(sql);
    const sanitizedParams = sanitize(params);
    const res = await pool.query(formatted, sanitizedParams);
    return res.rows;
  },

  // Fetch a single row
  get: async (sql, params = []) => {
    const formatted = formatSql(sql);
    const sanitizedParams = sanitize(params);
    const res = await pool.query(formatted, sanitizedParams);
    return res.rows[0];
  },

  // Execute INSERT, UPDATE, DELETE with backward-compatible lastID and changes
  run: async (sql, params = []) => {
    let formatted = formatSql(sql);
    const sanitizedParams = sanitize(params);

    const isInsert = /^\s*INSERT\s+INTO\s+/i.test(formatted);
    if (isInsert && !/RETURNING/i.test(formatted)) {
      formatted += ' RETURNING id';
    }

    const res = await pool.query(formatted, sanitizedParams);
    return {
      lastID: res.rows && res.rows[0] ? res.rows[0].id : null,
      changes: res.rowCount
    };
  }
};