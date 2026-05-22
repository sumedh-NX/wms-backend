const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const { clearStrategyCache } = require('../../utils/strategyEngine');

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT * FROM validation_strategies ORDER BY created_at DESC`);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
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

router.delete('/:id', async (req, res, next) => {
  try {
    await db.query(`DELETE FROM validation_strategies WHERE id=$1`, [req.params.id]);
    clearStrategyCache();
    res.json({ message: 'Strategy deleted successfully' });
  } catch (err) { next(err); }
});

module.exports = router;
