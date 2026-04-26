const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcrypt');
const { permit } = require('../middleware/auth');

// Only admins can touch these routes
router.use(permit('admin'));

/* ---------------------------------------------------------------
   USER MANAGEMENT (NEWLY ADDED & UPDATED)
----------------------------------------------------------------- */

// 1. LIST ALL USERS WITH THEIR ASSIGNED CUSTOMERS
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

// 2. CREATE NEW USER
router.post('/users', async (req, res, next) => {
  try {
    const { email, password, role, customerIds } = req.body;
    const hash = await bcrypt.hash(password, 12);

    await db.query('BEGIN');
    const { rows: userRows } = await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id`,
      [email, hash, role]
    );
    const userId = userRows[0].id;

    if (customerIds && customerIds.length > 0) {
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

// 3. UPDATE USER & SYNC CUSTOMERS
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
    if (customerIds && customerIds.length > 0) {
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

// 4. DELETE USER
router.delete('/users/:id', async (req, res, next) => {
  try {
    await db.query(`DELETE FROM users WHERE id=$1`, [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) { next(err); }
});

// 5. GET ALL CUSTOMERS (For the Admin User Modal dropdown)
router.get('/customers', async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT id, name, code FROM customers ORDER BY name ASC`);
    res.json(rows);
  } catch (err) { next(err); }
});


/* ---------------------------------------------------------------
   CUSTOMER & STRATEGY MANAGEMENT (EXISTING LOGIC RESTORED)
----------------------------------------------------------------- */

// Create Customer
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

// Mapping User to Customer (Basic endpoint)
router.post('/user-customer', async (req, res, next) => {
  const { userId, customerId } = req.body;
  try {
    await db.query(
      `INSERT INTO user_customers (user_id, customer_id) VALUES ($1,$2)`,
      [userId, customerId]
    );
    res.json({ message: 'Mapping added' });
  } catch (err) { next(err); }
});

// Create Validation Strategy
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
  } catch (err) { next(err); }
});

// Assign Strategy to Customer
router.post('/customer-strategy', async (req, res, next) => {
  const { customerId, strategyId } = req.body;
  try {
    await db.query(
      `INSERT INTO customer_strategies (customer_id, strategy_id)
       VALUES ($1,$2)`,
      [customerId, strategyId]
    );
    res.json({ message: 'Strategy assigned to customer' });
  } catch (err) { next(err); }
});

module.exports = router;
