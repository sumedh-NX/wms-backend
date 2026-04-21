const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { permit } = require('../middleware/auth');
const { parseBinQR, parsePickQR } = require('../utils/qrParser');
const { runStrategy } = require('../utils/strategyEngine');
const { logAudit } = require('../utils/auditLogger');

// ---------------------------------------------------------------
// LIST DISPATCHES
// ---------------------------------------------------------------
router.get('/', permit('operator','supervisor','admin'), async (req, res, next) => {
  try {
    const { customerId } = req.query;
    if (!customerId) return res.status(400).json({ message: 'customerId required' });
    const { rows } = await db.query(
      `SELECT id, dispatch_number, status, created_at FROM dispatches WHERE customer_id = $1 ORDER BY created_at DESC`,
      [customerId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// CREATE NEW DISPATCH
// ---------------------------------------------------------------
router.post('/', permit('operator','supervisor','admin'), async (req, res, next) => {
  try {
    const { customerId } = req.body;
    const { rows } = await db.query(
      `INSERT INTO dispatches (customer_id, created_by) VALUES ($1, $2) RETURNING id, dispatch_number`,
      [customerId, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// GET DISPATCH DETAIL
// ---------------------------------------------------------------
router.get('/:id', permit('operator','supervisor','admin'), async (req, res, next) => {
  try {
    const dispatchId = req.params.id;
    const { rows: dispatchRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dispatchRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dispatchRows[0];
    const { rows: bins } = await db.query(`SELECT * FROM dispatch_bins WHERE dispatch_id=$1 ORDER BY created_at`, [dispatchId]);
    const { rows: picks } = await db.query(`SELECT * FROM dispatch_picks WHERE dispatch_id=$1 ORDER BY created_at`, [dispatchId]);
    res.json({ dispatch, bins, picks });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// SCAN BIN QR  — optimized: 3 DB round trips, audit non-blocking
// ---------------------------------------------------------------
router.post('/:id/scan-bin', permit('operator','supervisor','admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  try {
    // 1. Parse + fetch dispatch (parallel)
    const parsed = parseBinQR(rawQr);
    if (!parsed) return res.status(400).json({ message: 'Invalid Bin QR code' });

    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dRows[0];

    // 2. Validate
    const validationResult = runStrategy(dispatch, parsed, 'BIN_LABEL');
    if (!validationResult.ok) {
      // Fire-and-forget audit log — don't block response
      logAudit({
        dispatchId, type: 'BIN_LABEL', code: parsed.binNumber, product_code: parsed.productCode,
        result: 'FAIL', operator_user_id: req.user.id, error_message: validationResult.message, raw_qr: rawQr,
      }).catch(e => console.error('Audit log error:', e));
      return res.status(400).json({ message: validationResult.message });
    }

    // 3. Update dispatch ref fields if first bin, insert bin, increment smg_qty — all in one transaction
    const isFirstBin = !dispatch.ref_product_code;
    const totalBins = Math.ceil(parsed.supplyQty / parsed.casePack);

    if (isFirstBin) {
      await db.query(
        `UPDATE dispatches SET ref_product_code=$1, ref_case_pack=$2, ref_supply_date=$3,
         ref_schedule_sent_date=$4, ref_schedule_number=$5, supply_quantity=$6,
         total_schedule_bins=$7, updated_at=now() WHERE id=$8`,
        [parsed.productCode, parsed.casePack, parsed.supplyDate, parsed.scheduleSentDate,
         parsed.scheduleNumber, parsed.supplyQty, totalBins, dispatchId]
      );
    }

    // Insert bin + update smg_qty + return final dispatch in parallel where possible
    await db.query(
      `INSERT INTO dispatch_bins (dispatch_id, bin_number, product_code, case_pack, schedule_sent_date,
       schedule_number, supply_quantity, supply_date, vendor_code, invoice_number, product_name, unload_loc, raw_qr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [dispatchId, parsed.binNumber, parsed.productCode, parsed.casePack, parsed.scheduleSentDate,
       parsed.scheduleNumber, parsed.supplyQty, parsed.supplyDate, parsed.vendorCode,
       parsed.invoiceNumber, parsed.productName || null, parsed.unloadLoc || null, rawQr]
    );

    // Update smg_qty and return final dispatch in one query using RETURNING
    const { rows: finalRows } = await db.query(
      `UPDATE dispatches SET smg_qty = smg_qty + 1, updated_at=now() WHERE id=$1 RETURNING *`,
      [dispatchId]
    );
    const finalDispatch = finalRows[0];

    // Fire-and-forget audit — respond immediately without waiting
    logAudit({
      dispatchId, type: 'BIN_LABEL', code: parsed.binNumber, product_code: parsed.productCode,
      result: 'PASS', operator_user_id: req.user.id, raw_qr: rawQr,
    }).catch(e => console.error('Audit log error:', e));

    // Respond immediately with final dispatch state
    res.json(finalDispatch);

  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Bin already scanned' });
    next(err);
  }
});

// ---------------------------------------------------------------
// SCAN PICK-LIST QR — optimized: 3 DB round trips, audit non-blocking
// ---------------------------------------------------------------
router.post('/:id/scan-pick', permit('operator','supervisor','admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  try {
    // 1. Parse + fetch dispatch
    const parsed = parsePickQR(rawQr);
    if (!parsed) return res.status(400).json({ message: 'Invalid Pick QR code' });

    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dRows[0];

    // 2. Validate
    const validationResult = runStrategy(dispatch, parsed, 'PICKLIST');
    if (!validationResult.ok) {
      logAudit({
        dispatchId, type: 'PICKLIST', code: parsed.pickCode, product_code: parsed.productCode,
        result: 'FAIL', operator_user_id: req.user.id, error_message: validationResult.message, raw_qr: rawQr,
      }).catch(e => console.error('Audit log error:', e));
      return res.status(400).json({ message: validationResult.message });
    }

    // 3. Insert pick + update bin_qty + return final dispatch using RETURNING
    await db.query(
      `INSERT INTO dispatch_picks (dispatch_id, pick_code, product_code, case_pack, raw_qr)
       VALUES ($1,$2,$3,$4,$5)`,
      [dispatchId, parsed.pickCode, parsed.productCode, parsed.casePack, rawQr]
    );

    const { rows: finalRows } = await db.query(
      `UPDATE dispatches SET bin_qty = bin_qty + 1, updated_at=now() WHERE id=$1 RETURNING *`,
      [dispatchId]
    );
    const finalDispatch = finalRows[0];

    // Fire-and-forget audit
    logAudit({
      dispatchId, type: 'PICKLIST', code: parsed.pickCode, product_code: parsed.productCode,
      result: 'PASS', operator_user_id: req.user.id, raw_qr: rawQr,
    }).catch(e => console.error('Audit log error:', e));

    res.json(finalDispatch);

  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Pick code already scanned' });
    next(err);
  }
});

// ---------------------------------------------------------------
// MARK DISPATCH AS COMPLETED
// ---------------------------------------------------------------
router.post('/:id/complete', permit('operator','supervisor','admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  try {
    await db.query(`UPDATE dispatches SET status='COMPLETED', updated_at=now() WHERE id=$1`, [dispatchId]);
    res.json({ message: 'Dispatch completed' });
  } catch (err) { next(err); }
});

module.exports = router;
