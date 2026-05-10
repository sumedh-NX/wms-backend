const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { permit } = require('../middleware/auth');

// 1. ONLY USE THESE TWO PARSERS (Remove any mention of qrParser.js)
const { parseBinQR, parsePickQR } = require('../utils/niteraParser'); 
const { parseUsuiBin, parseUsuiPart } = require('../utils/usuiParser');

const { runStrategy } = require('../utils/strategyEngine');
const { getStrategy } = require('../strategies');
const { logAudit } = require('../utils/auditLogger');


// USUI: Step 1 - Scan NX
router.post('/:id/scan-nx', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  try {
    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dRows[0];

    const strategyQuery = `SELECT vs.code FROM validation_strategies vs JOIN customer_strategies cs ON vs.id = cs.strategy_id WHERE cs.customer_id = $1`;
    const { rows: sRows } = await db.query(strategyQuery, [dispatch.customer_id]);
    if (sRows.length === 0) return res.status(400).json({ message: 'No strategy assigned to this customer' });

    const strategyLogic = getStrategy(sRows[0].code);
    const val = strategyLogic.validateNX(rawQr);
    if (!val.ok) return res.status(400).json({ message: val.message });

    await db.query(`UPDATE dispatches SET ref_product_code = $1, updated_at=now() WHERE id=$2`, [val.productCode, dispatchId]);
    res.json({ message: 'NX Product Identified', productCode: val.productCode });
  } catch (err) { next(err); }
});

// USUI: Step 2 - Scan Bin
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
    const { rows: binRow } = await db.query(
      `INSERT INTO dispatch_bins (dispatch_id, bin_number, product_code, supply_quantity, supply_date, raw_qr) 
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, 
      [dispatchId, parsed.binNumber, parsed.productCode, parsed.supplyQty, parsed.supplyDate, rawQr]
    );
    
    await db.query(`UPDATE dispatches SET smg_qty = smg_qty + 1, total_schedule_bins = ${Math.ceil(parsed.supplyQty/parsed.insidePartCount)} WHERE id=$1`, [dispatchId]);
    await db.query('COMMIT');

    res.json({ binId: binRow[0].id, requiredParts: parsed.insidePartCount, productCode: parsed.productCode });
  } catch (err) { next(err); }
});

// USUI: Step 3 - Scan Part
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

    await db.query(`INSERT INTO dispatch_parts (dispatch_id, bin_id, part_code, raw_qr) VALUES ($1,$2,$3,$4)`, 
      [dispatchId, binId, parsedPart.normalized, rawQr]);

    const { rows: countRows } = await db.query(`SELECT count(*) as total FROM dispatch_parts WHERE bin_id = $1`, [binId]);
    res.json({ count: parseInt(countRows[0].total), partCode: parsedPart.normalized });
  } catch (err) { next(err); }
});

// ... Keep existing Nitera /scan-bin and /scan-pick as they are ...
module.exports = router;
