const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { permit } = require('../middleware/auth');
const { parseBinQR, parsePickQR } = require('../utils/niteraParser'); 
const { parseUsuiBin, parseUsuiPart } = require('../utils/usuiParser');
const { runStrategy } = require('../utils/strategyEngine');
const { getStrategy } = require('../strategies');
const { logAudit } = require('../utils/auditLogger');

// ---------------------------------------------------------------
// 1. CORE MANAGEMENT (Required for the Dispatch Board)
// ---------------------------------------------------------------

// GET /api/dispatch - List all dispatches for a customer
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

// POST /api/dispatch - Create a new dispatch session
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

// GET /api/dispatch/:id - Get full details for the Dispatch Screen
router.get('/:id', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  try {
    const dispatchId = req.params.id;
    const { rows: dispatchRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dispatchRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dispatchRows[0];
    
    const { rows: bins } = await db.query(`SELECT * FROM dispatch_bins WHERE dispatch_id=$1 ORDER BY created_at`, [dispatchId]);
    const { rows: picks } = await db.query(`SELECT * FROM dispatch_picks WHERE dispatch_id=$1 ORDER BY created_at`, [dispatchId]);
    const { rows: parts } = await db.query(`SELECT * FROM dispatch_parts WHERE dispatch_id=$1 ORDER BY created_at`, [dispatchId]);
    
    const { rows: logs } = await db.query(
      `SELECT al.*, u.email as operator_name FROM audit_logs al JOIN users u ON al.operator_user_id = u.id WHERE al.dispatch_id=$1 ORDER BY al.created_at ASC`, 
      [dispatchId]
    );
    
    res.json({ dispatch, bins, picks, parts, logs });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// 2. NITERA WORKFLOW (1:1)
// ---------------------------------------------------------------

router.post('/:id/scan-bin', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  try {
    const parsed = parseBinQR(rawQr);
    if (!parsed) return res.status(400).json({ message: 'Invalid Bin QR code' });

    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    const dispatch = dRows[0];

    const validationResult = await runStrategy(dispatch, parsed, 'BIN_LABEL');
    if (!validationResult.ok) {
      logAudit({ dispatchId, type: 'BIN_LABEL', code: parsed.binNumber, product_code: parsed.productCode, result: 'FAIL', operator_user_id: req.user.id, error_message: validationResult.message, raw_qr: rawQr }).catch(console.error);
      return res.status(400).json({ message: validationResult.message });
    }

    await db.query('BEGIN');
    try {
      const isFirstBin = !dispatch.ref_product_code;
      const totalBins = Math.ceil(parsed.supplyQty / parsed.casePack);
      if (isFirstBin) {
        await db.query(`UPDATE dispatches SET ref_product_code=$1, ref_case_pack=$2, ref_supply_date=$3, ref_schedule_sent_date=$4, ref_schedule_number=$5, supply_quantity=$6, total_schedule_bins=$7, updated_at=now() WHERE id=$8`,
          [parsed.productCode, parsed.casePack, parsed.supplyDate, parsed.scheduleSentDate, parsed.scheduleNumber, parsed.supplyQty, totalBins, dispatchId]);
      }
      await db.query(`INSERT INTO dispatch_bins (dispatch_id, bin_number, product_code, case_pack, schedule_sent_date, schedule_number, supply_quantity, supply_date, vendor_code, invoice_number, product_name, unload_loc, raw_qr) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [dispatchId, parsed.binNumber, parsed.productCode, parsed.casePack, parsed.scheduleSentDate, parsed.scheduleNumber, parsed.supplyQty, parsed.supplyDate, parsed.vendorCode, parsed.invoiceNumber, parsed.productName || null, parsed.unloadLoc || null, rawQr]);

      const { rows: finalRows } = await db.query(`UPDATE dispatches SET smg_qty = smg_qty + 1, updated_at=now() WHERE id=$1 RETURNING *`, [dispatchId]);
      await db.query('COMMIT');
      logAudit({ dispatchId, type: 'BIN_LABEL', code: parsed.binNumber, product_code: parsed.productCode, result: 'PASS', operator_user_id: req.user.id, raw_qr: rawQr }).catch(console.error);
      res.json(finalRows[0]);
    } catch (txErr) { await db.query('ROLLBACK'); throw txErr; }
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Bin already scanned' });
    next(err);
  }
});

router.post('/:id/scan-pick', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  try {
    const parsed = parsePickQR(rawQr);
    if (!parsed) return res.status(400).json({ message: 'Invalid Pick QR code' });

    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    const dispatch = dRows[0];

    const validationResult = await runStrategy(dispatch, parsed, 'PICKLIST');
    if (!validationResult.ok) {
      logAudit({ dispatchId, type: 'PICKLIST', code: parsed.pickCode, product_code: parsed.productCode, result: 'FAIL', operator_user_id: req.user.id, error_message: validationResult.message, raw_qr: rawQr }).catch(console.error);
      return res.status(400).json({ message: validationResult.message });
    }

    await db.query('BEGIN');
    try {
      await db.query(`INSERT INTO dispatch_picks (dispatch_id, pick_code, product_code, case_pack, raw_qr) VALUES ($1,$2,$3,$4,$5)`, [dispatchId, parsed.pickCode, parsed.productCode, parsed.casePack, rawQr]);
      const { rows: finalRows } = await db.query(`UPDATE dispatches SET bin_qty = bin_qty + 1, updated_at=now() WHERE id=$1 RETURNING *`, [dispatchId]);
      await db.query('COMMIT');
      logAudit({ dispatchId, type: 'PICKLIST', code: parsed.pickCode, product_code: parsed.productCode, result: 'PASS', operator_user_id: req.user.id, raw_qr: rawQr }).catch(console.error);
      res.json(finalRows[0]);
    } catch (txErr) { await db.query('ROLLBACK'); throw txErr; }
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Pick code already scanned' });
    next(err);
  }
});

// ---------------------------------------------------------------
// 3. USUI WORKFLOW (1:Many)
// ---------------------------------------------------------------

router.post('/:id/scan-nx', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  try {
    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    const dispatch = dRows[0];
    const strategyQuery = `SELECT vs.code FROM validation_strategies vs JOIN customer_strategies cs ON vs.id = cs.strategy_id WHERE cs.customer_id = $1`;
    const { rows: sRows } = await db.query(strategyQuery, [dispatch.customer_id]);
    if (sRows.length === 0) return res.status(400).json({ message: 'No strategy assigned' });

    const strategyLogic = getStrategy(sRows[0].code);
    const val = strategyLogic.validateNX(rawQr);
    if (!val.ok) return res.status(400).json({ message: val.message });

    await db.query(`UPDATE dispatches SET ref_product_code = $1, updated_at=now() WHERE id=$2`, [val.productCode, dispatchId]);
    res.json({ message: 'NX Product Identified', productCode: val.productCode });
  } catch (err) { next(err); }
});

router.post('/:id/scan-bin-usui', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  try {
    const parsed = parseUsuiBin(rawQr);
    if (!parsed) return res.status(400).json({ message: 'Invalid USUI Bin QR' });

    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    const dispatch = dRows[0];

    const strategyQuery = `SELECT vs.code FROM validation_strategies vs JOIN customer_strategies cs ON vs.id = cs.strategy_id WHERE cs.customer_id = $1`;
    const { rows: sRows } = await db.query(strategyQuery, [dispatch.customer_id]);
    const strategyLogic = getStrategy(sRows[0].code);
    
    const val = strategyLogic.validateBin(dispatch.ref_product_code, parsed);
    if (!val.ok) return res.status(400).json({ message: val.message });

    const { rows: dup } = await db.query(`SELECT id FROM dispatch_bins WHERE bin_number = $1 AND dispatch_id = $2`, [parsed.binNumber, dispatchId]);
    if (dup.length > 0) return res.status(409).json({ message: 'Bin already scanned' });

    await db.query('BEGIN');
    try {
      const { rows: binRow } = await db.query(
        `INSERT INTO dispatch_bins (dispatch_id, bin_number, product_code, supply_quantity, supply_date, raw_qr) 
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, 
        [dispatchId, parsed.binNumber, parsed.productCode, parsed.supplyQty, parsed.supplyDate, rawQr]
      );
      await db.query(`UPDATE dispatches SET smg_qty = smg_qty + 1, total_schedule_bins = ${Math.ceil(parsed.supplyQty/parsed.insidePartCount)} WHERE id=$1`, [dispatchId]);
      await db.query('COMMIT');
      res.json({ binId: binRow[0].id, requiredParts: parsed.insidePartCount, productCode: parsed.productCode });
    } catch (txErr) { await db.query('ROLLBACK'); throw txErr; }
  } catch (err) { next(err); }
});

router.post('/:id/scan-part', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr, binId } = req.body;
  try {
    const parsedPart = parseUsuiPart(rawQr);
    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    const dispatch = dRows[0];

    const strategyQuery = `SELECT vs.code FROM validation_strategies vs JOIN customer_strategies cs ON vs.id = cs.strategy_id WHERE cs.customer_id = $1`;
    const { rows: sRows } = await db.query(strategyQuery, [dispatch.customer_id]);
    const strategyLogic = getStrategy(sRows[0].code);

    const val = await strategyLogic.validatePart(dispatch.ref_product_code, parsedPart.normalized, dispatchId, binId, db);
    if (!val.ok) return res.status(400).json({ message: val.message });

    await db.query(`INSERT INTO dispatch_parts (dispatch_id, bin_id, part_code, raw_qr) VALUES ($1,$2,$3,$4)`, [dispatchId, binId, parsedPart.normalized, rawQr]);
    const { rows: countRows } = await db.query(`SELECT count(*) as total FROM dispatch_parts WHERE bin_id = $1`, [binId]);
    res.json({ count: parseInt(countRows[0].total), partCode: parsedPart.normalized });
  } catch (err) { next(err); }
});

router.post('/:id/complete', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  try {
    await db.query(`UPDATE dispatches SET status='COMPLETED', updated_at=now() WHERE id=$1`, [req.params.id]);
    res.json({ message: 'Dispatch completed' });
  } catch (err) { next(err); }
});

module.exports = router;
