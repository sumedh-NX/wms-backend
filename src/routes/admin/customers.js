const express = require('express');
const router = express.Router();
const db = require('../../config/db');

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT id, name, code FROM customers ORDER BY name ASC`);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  const { name, code } = req.body;
  try {
    const { rows } = await db.query(
      `INSERT INTO customers (name, code) VALUES ($1,$2) RETURNING *`,
      [name, code]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
