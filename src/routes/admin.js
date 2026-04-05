const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcrypt');
const { permit } = require('../middleware/auth');

// Only admins can touch these routes
router.use(permit('admin'));

/* ---------- USERS ---------- */
router.post('/users', async (req, res, next) => {
  const { email, password, role } = req.body;
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1,$2,$3) RETURNING id,email,role`,
      [email, hash, role]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ---------- CUSTOMERS ---------- */
router.post('/customers', async (req, res, next) => {
  const { name, code } = req.body;
  try {
    const { rows } = await db.query(
      `INSERT INTO customers (name, code) VALUES ($1,$2) RETURNING *`,
      [name, code]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ---------- USER‑CUSTOMER MAPPING ---------- */
router.post('/user-customer', async (req, res, next) => {
  const { userId, customerId } = req.body;
  try {
    await db.query(
      `INSERT INTO user_customers (user_id, customer_id) VALUES ($1,$2)`,
      [userId, customerId]
    );
    res.json({ message: 'Mapping added' });
  } catch (err) {
    next(err);
  }
});

/* ---------- VALIDATION STRATEGY ---------- */
router.post('/strategies', async (req, res, next) => {
  const { code, name, description, config, custom_js } = req.body;
  try {
    const { rows } = await db.query(
      `INSERT INTO validation_strategies
        (code, name, description, config, custom_js)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [code, name, description, config, custom_js]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ---------- ASSIGN STRATEGY TO CUSTOMER ---------- */
router.post('/customer-strategy', async (req, res, next) => {
  const { customerId, strategyId } = req.body;
  try {
    await db.query(
      `INSERT INTO customer_strategies (customer_id, strategy_id)
       VALUES ($1,$2)`,
      [customerId, strategyId]
    );
    res.json({ message: 'Strategy assigned to customer' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
