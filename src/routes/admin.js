const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcrypt');
const { permit } = require('../middleware/auth');
// IMPORTANT: Import the cache clearer from the strategy engine
const { clearStrategyCache } = require('../utils/strategyEngine');

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

    await db.query('BEGIN'); 
    
    const { rows: userRows } = await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id`,
      [email, hash, role]
    );
    const userId = userRows[0].id;

    if (customerIds && Array.isArray(customerIds) && customerIds.length > 0) {
      for (const cId of customerIds) {
        await db.query(`INSERT INTO user_customers (user_id, customer_id) VALUES ($1, $2)`, [userId, cId]);
      }
    }

    await db.query('COMMIT'); 
    res.json({ message: 'User created successfully', userId });
  } catch (err) {
    await db.query('ROLLBACK'); 
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

    if (password) {
      const hash = await bcrypt.hash(password, 12);
      updateQuery += `, password_hash=$3`;
      params.push(hash);
    }
    updateQuery += ` WHERE id=$${params.length + 1}`;
    params.push(id);
    
    await db.query(updateQuery, params);

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

router.get('/customers', async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT id, name, code FROM customers ORDER BY name ASC`);
    res.json(rows);
  } catch (err) { next(err); }
});

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

router.get('/strategies', async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT * FROM validation_strategies ORDER BY created_at DESC`);
    res.json(rows);
  } catch (err) { next(err); }
});

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
   STRATEGY ASSIGNMENT & CACHE MANAGEMENT
----------------------------------------------------------------- */

// POST: Map a strategy to a customer AND clear the performance cache
router.post('/customer-strategy', async (req, res, next) => {
  const { customerId, strategyId } = req.body;
  try {
    await db.query('BEGIN');

    // 1. Remove existing strategy for this customer
    await db.query(`DELETE FROM customer_strategies WHERE customer_id=$1`, [customerId]);
    
    // 2. Insert new strategy link
    await db.query(
      `INSERT INTO customer_strategies (customer_id, strategy_id) VALUES ($1,$2)`,
      [customerId, strategyId]
    );

    await db.query('COMMIT');

    // 3. CRITICAL: Clear the cache so the operator sees the change immediately
    clearStrategyCache(customerId);

    res.json({ message: 'Strategy assigned successfully' });
  } catch (err) {
    await db.query('ROLLBACK');
    next(err);
  }
});

// GET: List all current customer-strategy mappings
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

// DELETE: Remove a specific customer-strategy link (Unlink)
router.delete('/customer-strategy/:customerId', async (req, res, next) => {
  try {
    await db.query(`DELETE FROM customer_strategies WHERE customer_id=$1`, [req.params.customerId]);
    
    // Clear cache so they move back to "Strict Mode/No Strategy" immediately
    clearStrategyCache(req.params.customerId);
    
    res.json({ message: 'Strategy unlinked from customer' });
  } catch (err) { next(err); }
});

// DELETE: Delete a validation strategy entirely
router.delete('/strategies/:id', async (req, res, next) => {
  try {
    await db.query(`DELETE FROM validation_strategies WHERE id=$1`, [req.params.id]);
    
    // Since this strategy might have been assigned to multiple customers,
    // we clear the entire strategy cache to be safe.
    clearStrategyCache(); 
    
    res.json({ message: 'Strategy deleted successfully' });
  } catch (err) { next(err); }
});

module.exports = router;
