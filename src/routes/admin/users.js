const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const bcrypt = require('bcrypt');

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT u.*,
      ARRAY_AGG(c.name) as assigned_customers
      FROM users u
      LEFT JOIN user_customers uc ON u.id = uc.user_id
      LEFT JOIN customers c ON uc.customer_id = c.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
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

router.put('/:id', async (req, res, next) => {
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

router.delete('/:id', async (req, res, next) => {
  try {
    await db.query(`DELETE FROM users WHERE id=$1`, [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
