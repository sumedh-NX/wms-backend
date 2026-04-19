// src/routes/setup.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcrypt');

router.get('/db', async (req, res) => {
  try {
    console.log("🚀 STARTING DATABASE RESET...");
    
    // Pure SQL: No comments allowed inside the string
    const schema = `
      DROP TABLE IF EXISTS audit_logs;
      DROP TABLE IF EXISTS dispatch_picks;
      DROP TABLE IF EXISTS dispatch_bins;
      DROP TABLE IF EXISTS dispatches;
      DROP TABLE IF EXISTS customer_strategies;
      DROP TABLE IF EXISTS validation_strategies;
      DROP TABLE IF EXISTS user_customers;
      DROP TABLE IF EXISTS customers;
      DROP TABLE IF EXISTS users;

      CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT CHECK (role IN ('admin','supervisor','operator')) NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE customers (id SERIAL PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE user_customers (user_id INT REFERENCES users(id) ON DELETE CASCADE, customer_id INT REFERENCES customers(id) ON DELETE CASCADE, PRIMARY KEY (user_id, customer_id));
      CREATE TABLE validation_strategies (id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, config JSONB NOT NULL DEFAULT '{}'::jsonb, custom_js TEXT, created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE customer_strategies (customer_id INT REFERENCES customers(id) ON DELETE CASCADE, strategy_id INT REFERENCES validation_strategies(id) ON DELETE CASCADE, PRIMARY KEY (customer_id, strategy_id));
      CREATE SEQUENCE IF NOT EXISTS dispatch_number_seq START 1;
      CREATE TABLE dispatches (id SERIAL PRIMARY KEY, dispatch_number BIGINT UNIQUE NOT NULL DEFAULT nextval('dispatch_number_seq'), customer_id INT REFERENCES customers(id) ON DELETE RESTRICT, created_by INT REFERENCES users(id) ON DELETE SET NULL, status TEXT CHECK (status IN ('IN_PROGRESS','COMPLETED')) NOT NULL DEFAULT 'IN_PROGRESS', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ref_product_code TEXT, ref_case_pack INT, ref_supply_date TEXT, ref_schedule_sent_date TEXT, ref_schedule_number TEXT, supply_quantity INT, total_schedule_bins INT, smg_qty INT DEFAULT 0, bin_qty INT DEFAULT 0);
      CREATE TABLE dispatch_bins (id SERIAL PRIMARY KEY, dispatch_id INT REFERENCES dispatches(id) ON DELETE CASCADE, bin_number TEXT NOT NULL, product_code TEXT NOT NULL, case_pack INT NOT NULL, schedule_sent_date TEXT, schedule_number TEXT, supply_quantity INT, supply_date TEXT, vendor_code TEXT, invoice_number TEXT, product_name TEXT, unload_loc TEXT, raw_qr TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), UNIQUE (dispatch_id, bin_number));
      CREATE TABLE dispatch_picks (id SERIAL PRIMARY KEY, dispatch_id INT REFERENCES dispatches(id) ON DELETE CASCADE, pick_code TEXT NOT NULL, product_code TEXT NOT NULL, case_pack INT, raw_qr TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), UNIQUE (dispatch_id, pick_code));
      CREATE TABLE audit_logs (id SERIAL PRIMARY KEY, dispatch_id INT REFERENCES dispatches(id) ON DELETE CASCADE, timestamp TIMESTAMPTZ DEFAULT now(), type TEXT CHECK (type IN ('BIN_LABEL','PICKLIST')) NOT NULL, code TEXT NOT NULL, product_code TEXT, result TEXT CHECK (result IN ('PASS','FAIL')) NOT NULL, operator_user_id INT REFERENCES users(id) ON DELETE SET NULL, error_message TEXT, raw_qr TEXT, created_at TIMESTAMPTZ DEFAULT now());
    `;

    await db.query(schema);
    res.status(200).json({ message: "DATABASE TOTAL RESET SUCCESSFUL: All tables recreated as TEXT." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin', async (req, res, next) => {
  try {
    const { email, password, role } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role`, [email, passwordHash, role]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/customer', async (req, res, next) => {
  try {
    const { name, code } = req.body;
    const { rows } = await db.query(`INSERT INTO customers (name, code) VALUES ($1, $2) RETURNING id, name, code`, [name, code]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/link', async (req, res, next) => {
  try {
    const { userId, customerId } = req.body;
    await db.query(`INSERT INTO user_customers (user_id, customer_id) VALUES ($1, $2)`, [userId, customerId]);
    res.status(201).json({ message: "User successfully linked to customer" });
  } catch (err) { next(err); }
});

module.exports = router;
