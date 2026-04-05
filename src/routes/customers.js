const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { permit } = require('../middleware/auth');

// GET /api/customers          – list customers assigned to this user
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.code
       FROM customers c
       JOIN user_customers uc ON uc.customer_id = c.id
       WHERE uc.user_id = $1`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
