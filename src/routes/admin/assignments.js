const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const { clearStrategyCache } = require('../../utils/strategyEngine');

router.post('/', async (req, res, next) => {
  const { customerId, strategyId } = req.body;
  try {
    await db.query('BEGIN');
    await db.query(`DELETE FROM customer_strategies WHERE customer_id=$1`, [customerId]);
    await db.query(
      `INSERT INTO customer_strategies (customer_id, strategy_id) VALUES ($1,$2)`,
      [customerId, strategyId]
    );
    await db.query('COMMIT');
    clearStrategyCache(customerId);
    res.json({ message: 'Strategy assigned successfully' });
  } catch (err) {
    await db.query('ROLLBACK');
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT cs.customer_id, c.name as customer_name,
             vs.name as strategy_name, vs.code as strategy_code, vs.id as strategy_id
      FROM customer_strategies cs
      JOIN customers c ON cs.customer_id = c.id
      JOIN validation_strategies vs ON cs.strategy_id = vs.id
      ORDER BY c.name ASC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.delete('/:customerId', async (req, res, next) => {
  try {
    await db.query(`DELETE FROM customer_strategies WHERE customer_id=$1`, [req.params.customerId]);
    clearStrategyCache(req.params.customerId);
    res.json({ message: 'Strategy unlinked from customer' });
  } catch (err) { next(err); }
});

module.exports = router;
