// src/config/db.js
require('dotenv').config();
const { Pool } = require('pg');

// Create a new connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render requires SSL. 
  // rejectUnauthorized: false is necessary because Render uses self-signed certificates.
  ssl: {
    rejectUnauthorized: false 
  }
});

// Helper function to execute queries
module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
