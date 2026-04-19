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
// SCAN BIN QR
// ---------------------------------------------------------------
router.post('/:id/scan-bin', permit('operator','supervisor','admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  try {
    const parsed = parseBinQR(rawQr);
    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dRows[0];

    const isFirstBin = !dispatch.ref_product_code;
    if (isFirstBin) {
      const totalBins = Math.ceil(parsed.supplyQty / parsed.casePack);
      await db.query(
        `UPDATE dispatches SET ref_product_code=$1, ref_case_pack=$2, ref_supply_date=$3, 
         ref_schedule_sent_date=$4, ref_schedule_number=$5, supply_quantity=$6, 
         total_schedule_bins=$7, updated_at=now() WHERE id=$8`,
        [parsed.productCode, parsed.casePack, parsed.supplyDate, parsed.scheduleSentDate, parsed.scheduleNumber, parsed.supplyQty, totalBins, dispatchId]
      );
    }

    const validationResult = runStrategy(dispatch, parsed, 'BIN_LABEL');
    if (!validationResult.ok) {
      await logAudit({
        dispatchId, type: 'BIN_LABEL', code: parsed.binNumber, product_code: parsed.productCode,
        result: 'FAIL', operator_user_id: req.user.id, error_message: validationResult.message, raw_qr: rawQr,
        // Add comprehensive data for failed scans
        schedule_number: parsed.scheduleNumber, nagare_time: parsed.scheduleSentDate,
        scheduled_bins: dispatch.total_schedule_bins, smg_qty: dispatch.smg_qty, bin_qty: dispatch.bin_qty
      });
      return res.status(400).json({ message: validationResult.message });
    }

    await db.query(
      `INSERT INTO dispatch_bins (dispatch_id, bin_number, product_code, case_pack, schedule_sent_date, 
       schedule_number, supply_quantity, supply_date, vendor_code, invoice_number, product_name, unload_loc, raw_qr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [dispatchId, parsed.binNumber, parsed.productCode, parsed.casePack, parsed.scheduleSentDate, parsed.scheduleNumber, parsed.supplyQty, parsed.supplyDate, parsed.vendorCode, parsed.invoiceNumber, parsed.productName, parsed.unloadLoc, rawQr]
    );

    await db.query(`UPDATE dispatches SET smg_qty = smg_qty + 1, updated_at=now() WHERE id=$1`, [dispatchId]);

    await logAudit({
      dispatchId, type: 'BIN_LABEL', code: parsed.binNumber, product_code: parsed.productCode,
      result: 'PASS', operator_user_id: req.user.id, raw_qr: rawQr,
      schedule_number: parsed.scheduleNumber, nagare_time: parsed.scheduleSentDate,
      scheduled_bins: dispatch.total_schedule_bins + 1, smg_qty: dispatch.smg_qty + 1, bin_qty: dispatch.bin_qty
    });

    const { rows: finalDispatch } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    res.json(finalDispatch[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Bin already scanned' });
    next(err);
  }
});

// ---------------------------------------------------------------
// SCAN PICK‑LIST QR
// ---------------------------------------------------------------
router.post('/:id/scan-pick', permit('operator','supervisor','admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  try {
    const parsed = parsePickQR(rawQr);
    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dRows[0];

    const validationResult = runStrategy(dispatch, parsed, 'PICKLIST');
    if (!validationResult.ok) {
      await logAudit({
        dispatchId, type: 'PICKLIST', code: parsed.pickCode, product_code: parsed.productCode,
        result: 'FAIL', operator_user_id: req.user.id, error_message: validationResult.message, raw_qr: rawQr,
        schedule_number: dispatch.ref_schedule_number, nagare_time: dispatch.ref_schedule_sent_date,
        scheduled_bins: dispatch.total_schedule_bins, smg_qty: dispatch.smg_qty, bin_qty: dispatch.bin_qty
      });
      return res.status(400).json({ message: validationResult.message, });
    }

    await db.query(
      `INSERT INTO dispatch_picks (dispatch_id, pick_code, product_code, case_pack, raw_qr)
       VALUES ($1,$2,$3,$4,$5)`,
      [dispatchId, parsed.pickCode, parsed.productCode, parsed.casePack, rawQr]
    );

    await db.query(`UPDATE dispatches SET bin_qty = bin_qty + 1, updated_at=now() WHERE id=$1`, [dispatchId]);

    await logAudit({
      dispatchId, type: 'PICKLIST', code: parsed.pickCode, product_code: parsed.productCode,
      result: 'PASS', operator_user_id: req.user.id, raw_qr: rawQr,
      schedule_number: dispatch.ref_schedule_number, nagare_time: dispatch.ref_schedule_sent_date,
      scheduled_bins: dispatch.total_schedule_bins, smg_qty: dispatch.smg_qty, bin_qty: dispatch.bin_qty + 1
    });

    const { rows: finalDispatch } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    res.json(finalDispatch[0]);
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
