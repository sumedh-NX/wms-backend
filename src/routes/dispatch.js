const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { permit } = require('../middleware/auth');

// ===============================================================================
// CORE DISPATCH MANAGEMENT (Shared by all customers)
// ===============================================================================

// GET /api/dispatch - List dispatches for a customer
router.get('/', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  try {
    const { customerId, startDate, endDate } = req.query;
    if (!customerId) return res.status(400).json({ message: 'customerId required' });
    
    let query = `SELECT * FROM dispatches WHERE customer_id = $1`;
    let params = [customerId];
    
    if (startDate && endDate) {
      query += ` AND created_at >= $2::timestamp AND created_at <= $3::timestamp`;
      params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
    }
    
    query += ` ORDER BY created_at DESC`;
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/dispatch - Create new dispatch
router.post('/', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  try {
    const { customerId } = req.body;
    const { rows } = await db.query(
      `INSERT INTO dispatches (customer_id, created_by) VALUES ($1, $2) RETURNING id, dispatch_number`,
      [customerId, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/dispatch/:id - Get full dispatch details
// GET /api/dispatch/:id - Get full dispatch details (INCLUDES STRATEGY CODE)
router.get('/:id', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  try {
    const dispatchId = req.params.id;
    const { rows: dispatchRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    
    if (dispatchRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dispatchRows[0];
    
    // Fetch all related data including the strategy code
    const [bins, picks, parts, logs, strategyRows] = await Promise.all([
      db.query(`SELECT * FROM dispatch_bins WHERE dispatch_id=$1 ORDER BY created_at`, [dispatchId]).then(r => r.rows),
      db.query(`SELECT * FROM dispatch_picks WHERE dispatch_id=$1 ORDER BY created_at`, [dispatchId]).then(r => r.rows),
      db.query(`SELECT * FROM dispatch_parts WHERE dispatch_id=$1 ORDER BY created_at`, [dispatchId]).then(r => r.rows),
      db.query(
        `SELECT al.*, u.email as operator_name FROM audit_logs al 
         JOIN users u ON al.operator_user_id = u.id 
         WHERE al.dispatch_id=$1 ORDER BY al.created_at ASC`, 
        [dispatchId]
      ).then(r => r.rows),
      // NEW: Fetch the strategy code for this customer
      db.query(
        `SELECT vs.code FROM validation_strategies vs
         JOIN customer_strategies cs ON vs.id = cs.strategy_id
         WHERE cs.customer_id = $1`,
        [dispatch.customer_id]
      ).then(r => r.rows)
    ]);
    
    // Attach strategy_code to the dispatch object
    const strategyCode = strategyRows.length > 0 ? strategyRows[0].code : null;
    
    res.json({ 
      dispatch: { ...dispatch, strategy_code: strategyCode }, 
      bins, picks, parts, logs 
    });
  } catch (err) { next(err); }
});

// POST /api/dispatch/:id/complete - Manual completion with validation
router.post('/:id/complete', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  try {
    const dispatchId = req.params.id;
    
    // Fetch dispatch state
    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dRows[0];
    
    // Validate completion based on workflow type
    // Check if it's Usui by looking at dispatch_parts
    const { rows: partsRows } = await db.query(
      `SELECT count(*) as total FROM dispatch_parts WHERE dispatch_id = $1`, 
      [dispatchId]
    );
    const totalParts = parseInt(partsRows[0].total);
    
    if (totalParts > 0) {
      // USUI WORKFLOW: Check all parts scanned
      const expectedTotal = dispatch.total_schedule_bins * dispatch.ref_case_pack;
      if (totalParts < expectedTotal) {
        return res.status(400).json({ 
          message: `Cannot complete: Only ${totalParts}/${expectedTotal} parts scanned.` 
        });
      }
    } else {
      // NITERA WORKFLOW: Check bins and picks
      if (dispatch.smg_qty !== dispatch.total_schedule_bins || 
          dispatch.bin_qty !== dispatch.total_schedule_bins) {
        return res.status(400).json({ 
          message: `Cannot complete: Bins ${dispatch.smg_qty}/${dispatch.total_schedule_bins}, Picks ${dispatch.bin_qty}/${dispatch.total_schedule_bins}` 
        });
      }
    }
    
    await db.query(`UPDATE dispatches SET status='COMPLETED', updated_at=now() WHERE id=$1`, [dispatchId]);
    res.json({ message: 'Dispatch completed' });
  } catch (err) { next(err); }
});

module.exports = router;