// src/routes/setup.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcrypt');

// ---------------------------------------------------------------
// ROUTE 1: /api/setup/db  <-- THE MAGIC BUTTON
// This route creates all the tables in your database automatically.
// ---------------------------------------------------------------
router.get('/db', async (req, res, next) => {
  try {
    console.log("Starting database schema creation...");
    
    const schema = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT CHECK (role IN ('admin','supervisor','operator')) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS user_customers (
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, customer_id)
      );

      CREATE TABLE IF NOT EXISTS validation_strategies (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        custom_js TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS customer_strategies (
        customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
        strategy_id INT REFERENCES validation_strategies(id) ON DELETE CASCADE,
        PRIMARY KEY (customer_id, strategy_id)
      );

      CREATE SEQUENCE IF NOT EXISTS dispatch_number_seq START 1;

      CREATE TABLE IF NOT EXISTS dispatches (
        id SERIAL PRIMARY KEY,
        dispatch_number BIGINT UNIQUE NOT NULL DEFAULT nextval('dispatch_number_seq'),
        customer_id INT REFERENCES customers(id) ON DELETE RESTRICT,
        created_by INT REFERENCES users(id) ON DELETE SET NULL,
        status TEXT CHECK (status IN ('IN_PROGRESS','COMPLETED')) NOT NULL DEFAULT 'IN_PROGRESS',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        ref_product_code TEXT,
        ref_case_pack INT,
        ref_supply_date DATE,
        ref_schedule_sent_date DATE,
        ref_schedule_number TEXT,
        supply_quantity INT,
        total_schedule_bins INT,
        smg_qty INT DEFAULT 0,
        bin_qty INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS dispatch_bins (
        id SERIAL PRIMARY KEY,
        dispatch_id INT REFERENCES dispatches(id) ON DELETE CASCADE,
        bin_number TEXT NOT NULL,
        product_code TEXT NOT NULL,
        case_pack INT NOT NULL,
        schedule_sent_date DATE,
        schedule_number TEXT,
        supply_quantity INT,
        supply_date DATE,
        vendor_code TEXT,
        invoice_number TEXT,
        product_name TEXT,
        unload_loc TEXT,
        raw_qr TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (dispatch_id, bin_number)
      );

      CREATE TABLE IF NOT EXISTS dispatch_picks (
        id SERIAL PRIMARY KEY,
        dispatch_id INT REFERENCES dispatches(id) ON DELETE CASCADE,
        pick_code TEXT NOT NULL,
        product_code TEXT NOT NULL,
        case_pack INT,
        raw_qr TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (dispatch_id, pick_code)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        dispatch_id INT REFERENCES dispatches(id) ON DELETE CASCADE,
        timestamp TIMESTAMPTZ DEFAULT now(),
        type TEXT CHECK (type IN ('BIN_LABEL','PICKLIST')) NOT NULL,
        code TEXT NOT NULL,
        product_code TEXT,
        result TEXT CHECK (result IN ('PASS','FAIL')) NOT NULL,
        operator_user_id INT REFERENCES users(id) ON DELETE SET NULL,
        error_message TEXT,
        raw_qr TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `;

    await db.query(schema);
    res.status(200).json({ message: "Database tables created successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// ROUTE 2: /api/setup/admin (Same as before)
// ---------------------------------------------------------------
router.post('/admin', async (req, res, next) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password || !role) return res.status(400).json({ message: 'Missing fields' });
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role`,
      [email, passwordHash, role]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'User exists' });
    next(err);
  }
});

module.exports = router;
