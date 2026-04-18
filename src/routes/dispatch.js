const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { permit } = require('../middleware/auth');

const { parseBinQR, parsePickQR } = require('../utils/qrParser');
const { runStrategy } = require('../utils/strategyEngine');
const { logAudit } = require('../utils/auditLogger');

// ---------------------------------------------------------------
// GET /api/dispatch?customerId=X  -- List all dispatches for a customer
// ---------------------------------------------------------------
router.get('/', permit('operator','supervisor','admin'), async (req, res, next) => {
  try {
    const { customerId } = req.query;
    
    if (!customerId) {
      return res.status(400).json({ message: 'customerId query parameter is required' });
    }

    const { rows } = await db.query(
      `SELECT id, dispatch_number, status, created_at 
       FROM dispatches 
       WHERE customer_id = $1 
       ORDER BY created_at DESC`,
      [customerId]
    );
    
    res.json(rows);
  } catch (err) {
    next(err);
  }
});


// ---------------------------------------------------------------
// CREATE NEW DISPATCH
// POST /api/dispatch   { customerId }
router.post('/', permit('operator','supervisor','admin'), async (req, res, next) => {
  try {
    const { customerId } = req.body;
    const { rows } = await db.query(
      `INSERT INTO dispatches (customer_id, created_by)
       VALUES ($1, $2)
       RETURNING id, dispatch_number`,
      [customerId, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET DISPATCH DETAIL (including already scanned bins/picks)
router.get('/:id', permit('operator','supervisor','admin'), async (req, res, next) => {
  try {
    const dispatchId = req.params.id;
    const { rows: dispatchRows } = await db.query(
      `SELECT * FROM dispatches WHERE id=$1`,
      [dispatchId]
    );
    if (dispatchRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dispatchRows[0];

    const { rows: bins } = await db.query(
      `SELECT bin_number, product_code, case_pack, raw_qr, created_at
       FROM dispatch_bins WHERE dispatch_id=$1 ORDER BY created_at`,
      [dispatchId]
    );
    const { rows: picks } = await db.query(
      `SELECT pick_code, product_code, case_pack, raw_qr, created_at
       FROM dispatch_picks WHERE dispatch_id=$1 ORDER BY created_at`,
      [dispatchId]
    );

    res.json({ dispatch, bins, picks });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// SCAN BIN QR
// POST /api/dispatch/:id/scan-bin   { rawQr }
router.post('/:id/scan-bin', permit('operator','supervisor','admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  try {
    const parsed = parseBinQR(rawQr); // throws if cannot parse
    // === STEP 1 – fetch dispatch (including reference values) ===
    const { rows: dRows } = await db.query(
      `SELECT * FROM dispatches WHERE id=$1`,
      [dispatchId]
    );
    if (dRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dRows[0];

    // === STEP 2 – FIRST BIN? ===
    const isFirstBin = !dispatch.ref_product_code; // null on first bin
    if (isFirstBin) {
      // Save reference data and compute total_schedule_bins
      const totalBins = Math.ceil(parsed.supplyQuantity / parsed.casePack);
      await db.query(
        `UPDATE dispatches SET
           ref_product_code=$1,
           ref_case_pack=$2,
           ref_supply_date=$3,
           ref_schedule_sent_date=$4,
           ref_schedule_number=$5,
           supply_quantity=$6,
           total_schedule_bins=$7,
           updated_at=now()
         WHERE id=$8`,
        [
          parsed.productCode,
          parsed.casePack,
          parsed.supplyDate,
          parsed.scheduleSentDate,
          parsed.scheduleNumber,
          parsed.supplyQuantity,
          totalBins,
          dispatchId,
        ]
      );
    }

    // === STEP 3 – VALIDATE AGAINST REFERENCE ===
    const validationResult = runStrategy(dispatch, parsed, 'BIN_LABEL');
    if (!validationResult.ok) {
      await logAudit({
        dispatchId,
        type: 'BIN_LABEL',
        code: parsed.binNumber,
        product_code: parsed.productCode,
        result: 'FAIL',
        operator_user_id: req.user.id,
        error_message: validationResult.message,
        raw_qr: rawQr,
      });
      return res.status(400).json({ message: validationResult.message });
    }

    // === STEP 4 – INSERT BIN ROW (unique constraint protects duplicate) ===
    await db.query(
      `INSERT INTO dispatch_bins
        (dispatch_id, bin_number, product_code, case_pack,
         schedule_sent_date, schedule_number, supply_quantity,
         supply_date, vendor_code, invoice_number, product_name,
         unload_loc, raw_qr)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        dispatchId,
        parsed.binNumber,
        parsed.productCode,
        parsed.casePack,
        parsed.scheduleSentDate,
        parsed.scheduleNumber,
        parsed.supplyQuantity,
        parsed.supplyDate,
        parsed.vendorCode,
        parsed.invoiceNumber,
        parsed.productName,
        parsed.unloadLoc,
        rawQr,
      ]
    );

    // === STEP 5 – INCREMENT SMG Qty & log audit (PASS) ===
    await db.query(
      `UPDATE dispatches SET smg_qty = smg_qty + 1, updated_at=now() WHERE id=$1`,
      [dispatchId]
    );

    await logAudit({
      dispatchId,
      type: 'BIN_LABEL',
      code: parsed.binNumber,
      product_code: parsed.productCode,
      result: 'PASS',
      operator_user_id: req.user.id,
      raw_qr: rawQr,
    });

    // Return fresh counters for UI
    const { rows: cnt } = await db.query(
      `SELECT smg_qty, total_schedule_bins FROM dispatches WHERE id=$1`,
      [dispatchId]
    );
    res.json({ smg_qty: cnt[0].smg_qty, total_schedule_bins: cnt[0].total_schedule_bins });
  } catch (err) {
    // Duplicate bin number => Postgres throws unique_violation (code 23505)
    if (err.code === '23505') {
      const msg = 'Bin already scanned';
      await logAudit({
        dispatchId,
        type: 'BIN_LABEL',
        code: rawQr,   // we don’t have a clean bin number, but it’s a duplicate attempt
        result: 'FAIL',
        operator_user_id: req.user.id,
        error_message: msg,
        raw_qr: rawQr,
      });
      return res.status(409).json({ message: msg });
    }
    next(err);
  }
});

// ---------------------------------------------------------------
// SCAN PICK‑LIST QR
// POST /api/dispatch/:id/scan-pick   { rawQr }
router.post('/:id/scan-pick', permit('operator','supervisor','admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  try {
    const parsed = parsePickQR(rawQr); // throws on invalid format

    // Get dispatch (reference data)
    const { rows: dRows } = await db.query(
      `SELECT * FROM dispatches WHERE id=$1`,
      [dispatchId]
    );
    if (dRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dRows[0];

    // Validation against reference
    const validationResult = runStrategy(dispatch, parsed, 'PICKLIST');
    if (!validationResult.ok) {
      await logAudit({
        dispatchId,
        type: 'PICKLIST',
        code: parsed.pickCode,
        product_code: parsed.productCode,
        result: 'FAIL',
        operator_user_id: req.user.id,
        error_message: validationResult.message,
        raw_qr: rawQr,
      });
      return res.status(400).json({ message: validationResult.message });
    }

    // Insert pick (unique on pick_code)
    await db.query(
      `INSERT INTO dispatch_picks
         (dispatch_id, pick_code, product_code, case_pack, raw_qr)
       VALUES
         ($1,$2,$3,$4,$5)`,
      [dispatchId, parsed.pickCode, parsed.productCode, parsed.casePack, rawQr]
    );

    // Increment Bin Qty
    await db.query(
      `UPDATE dispatches SET bin_qty = bin_qty + 1, updated_at=now() WHERE id=$1`,
      [dispatchId]
    );

    await logAudit({
      dispatchId,
      type: 'PICKLIST',
      code: parsed.pickCode,
      product_code: parsed.productCode,
      result: 'PASS',
      operator_user_id: req.user.id,
      raw_qr: rawQr,
    });

    const { rows: cnt } = await db.query(
      `SELECT bin_qty, total_schedule_bins FROM dispatches WHERE id=$1`,
      [dispatchId]
    );
    res.json({ bin_qty: cnt[0].bin_qty, total_schedule_bins: cnt[0].total_schedule_bins });
  } catch (err) {
    if (err.code === '23505') {
      const msg = 'Pick code already scanned';
      await logAudit({
        dispatchId,
        type: 'PICKLIST',
        code: rawQr,
        result: 'FAIL',
        operator_user_id: req.user.id,
        error_message: msg,
        raw_qr: rawQr,
      });
      return res.status(409).json({ message: msg });
    }
    next(err);
  }
});

// ---------------------------------------------------------------
// MARK DISPATCH AS COMPLETED
// POST /api/dispatch/:id/complete
router.post('/:id/complete', permit('operator','supervisor','admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  try {
    await db.query(
      `UPDATE dispatches SET status='COMPLETED', updated_at=now() WHERE id=$1`,
      [dispatchId]
    );
    res.json({ message: 'Dispatch completed' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
