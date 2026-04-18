require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // This fixes the "SSL/TLS required" error
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
