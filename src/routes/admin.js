const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcrypt');
const { permit } = require('../middleware/auth');

// 🛡️ SECURITY: Only users with 'admin' role can access any route in this file
router.use(permit('admin'));

/* -----------------------------------------------------------------
   1. USER MANAGEMENT
----------------------------------------------------------------- */

// GET: List all users with their assigned customers
router.get('/users', async (req, res, next) => {
  try {
    const query = `
      SELECT u.*, 
      ARRAY_AGG(c.name) as assigned_customers
      FROM users u
      LEFT JOIN user_customers uc ON u.id = uc.user_id
      LEFT JOIN customers c ON uc.customer_id = c.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST: Create a new user and assign customers
router.post('/users', async (req, res, next) => {
  try {
    const { email, password, role, customerIds } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ message: 'Email, password, and role are required' });
    }

    const hash = await bcrypt.hash(password, 12);

    await db.query('BEGIN'); // Start transaction
    
    const { rows: userRows } = await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id`,
      [email, hash, role]
    );
    const userId = userRows[0].id;

    // Assign customers if provided
    if (customerIds && Array.isArray(customerIds) && customerIds.length > 0) {
      for (const cId of customerIds) {
        await db.query(`INSERT INTO user_customers (user_id, customer_id) VALUES ($1, $2)`, [userId, cId]);
      }
    }

    await db.query('COMMIT'); // Save changes
    res.json({ message: 'User created successfully', userId });
  } catch (err) {
    await db.query('ROLLBACK'); // Undo changes if error occurs
    next(err);
  }
});

// PUT: Update user details and re-sync customer assignments
router.put('/users/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email, password, role, customerIds } = req.body;

    await db.query('BEGIN');

    let updateQuery = `UPDATE users SET email=$1, role=$2`;
    let params = [email, role];

    // Only update password if a new one was provided
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      updateQuery += `, password_hash=$3`;
      params.push(hash);
    }
    updateQuery += ` WHERE id=$${params.length + 1}`;
    params.push(id);
    
    await db.query(updateQuery, params);

    // Refresh Customer Mapping: Delete old and insert new
    await db.query(`DELETE FROM user_customers WHERE user_id=$1`, [id]);
    if (customerIds && Array.isArray(customerIds) && customerIds.length > 0) {
      for (const cId of customerIds) {
        await db.query(`INSERT INTO user_customers (user_id, customer_id) VALUES ($1, $2)`, [id, cId]);
      }
    }

    await db.query('COMMIT');
    res.json({ message: 'User updated successfully' });
  } catch (err) {
    await db.query('ROLLBACK');
    next(err);
  }
});

// DELETE: Remove user
router.delete('/users/:id', async (req, res, next) => {
  try {
    await db.query(`DELETE FROM users WHERE id=$1`, [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) { next(err); }
});

/* -----------------------------------------------------------------
   2. CUSTOMER MANAGEMENT
----------------------------------------------------------------- */

// GET: List all customers (Used for Admin Dropdowns)
router.get('/customers', async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT id, name, code FROM customers ORDER BY name ASC`);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST: Create a new customer
router.post('/customers', async (req, res, next) => {
  const { name, code } = req.body;
  try {
    const { rows } = await db.query(
      `INSERT INTO customers (name, code) VALUES ($1,$2) RETURNING *`,
      [name, code]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/* -----------------------------------------------------------------
   3. VALIDATION STRATEGY MANAGEMENT
----------------------------------------------------------------- */

// GET: List all defined strategies
router.get('/strategies', async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT * FROM validation_strategies ORDER BY created_at DESC`);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST: Create a new validation strategy
router.post('/strategies', async (req, res, next) => {
  const { code, name, description, config, custom_js } = req.body;
  try {
    const configString = typeof config === 'object' ? JSON.stringify(config) : config;
    
    const { rows } = await db.query(
      `INSERT INTO validation_strategies (code, name, description, config, custom_js)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [code, name, description, configString, custom_js]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/* -----------------------------------------------------------------
   STRATEGY MANAGEMENT UPDATES
----------------------------------------------------------------- */

// 1. NEW: POST Map a strategy to a customer (RESTORED)
router.post('/customer-strategy', async (req, res, next) => {
  const { customerId, strategyId } = req.body;
  try {
    // Remove existing strategy for this customer to prevent duplicates
    await db.query(`DELETE FROM customer_strategies WHERE customer_id=$1`, [customerId]);
    
    await db.query(
      `INSERT INTO customer_strategies (customer_id, strategy_id) VALUES ($1,$2)`,
      [customerId, strategyId]
    );
    res.json({ message: 'Strategy assigned successfully' });
  } catch (err) { next(err); }
});

// 2. NEW: GET all current customer-strategy mappings
router.get('/customer-strategies', async (req, res, next) => {
  try {
    const query = `
      SELECT cs.customer_id, c.name as customer_name, vs.name as strategy_name, vs.code as strategy_code, vs.id as strategy_id
      FROM customer_strategies cs
      JOIN customers c ON cs.customer_id = c.id
      JOIN validation_strategies vs ON cs.strategy_id = vs.id
      ORDER BY c.name ASC
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (err) { next(err); }
});

// 3. NEW: Delete a specific customer-strategy link (Unlink)
router.delete('/customer-strategy/:customerId', async (req, res, next) => {
  try {
    await db.query(`DELETE FROM customer_strategies WHERE customer_id=$1`, [req.params.customerId]);
    res.json({ message: 'Strategy unlinked from customer' });
  } catch (err) { next(err); }
});

// 4. NEW: Delete a validation strategy entirely
router.delete('/strategies/:id', async (req, res, next) => {
  try {
    await db.query(`DELETE FROM validation_strategies WHERE id=$1`, [req.params.id]);
    res.json({ message: 'Strategy deleted successfully' });
  } catch (err) { next(err); }
});

module.exports = router;
