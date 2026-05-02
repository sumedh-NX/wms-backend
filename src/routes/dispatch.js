const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { permit } = require('../middleware/auth');
const { parseBinQR, parsePickQR } = require('../utils/qrParser');
const { runStrategy } = require('../utils/strategyEngine');
const { logAudit } = require('../utils/auditLogger');

// ---------------------------------------------------------------
// LIST DISPATCHES (UPDATED: Added Date Range Filter)
// ---------------------------------------------------------------

router.get('/', permit('operator','supervisor','admin'), async (req, res, next) => {
  try {
    const { customerId, startDate, endDate } = req.query;
    if (!customerId) return res.status(400).json({ message: 'customerId required' });

    let query = `SELECT * FROM dispatches WHERE customer_id = $1`;
    let params = [customerId];

    // Filter by Dispatch Date (created_at)
    if (startDate && endDate) {
      query += ` AND created_at >= $2::timestamp AND created_at <= $3::timestamp`;
      params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
    }

    query += ` ORDER BY created_at DESC`;
    const { rows } = await db.query(query, params);
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
// GET DISPATCH DETAIL (UPDATED: Added Audit Logs for PDF)
// ---------------------------------------------------------------
router.get('/:id', permit('operator','supervisor','admin'), async (req, res, next) => {
  try {
    const dispatchId = req.params.id;
    const { rows: dispatchRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dispatchRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dispatchRows[0];
    
    const { rows: bins } = await db.query(`SELECT * FROM dispatch_bins WHERE dispatch_id=$1 ORDER BY created_at`, [dispatchId]);
    const { rows: picks } = await db.query(`SELECT * FROM dispatch_picks WHERE dispatch_id=$1 ORDER BY created_at`, [dispatchId]);
    
    // UPDATED: Join with users table to get the actual operator name/email
    const { rows: logs } = await db.query(
      `SELECT al.*, u.email as operator_name 
       FROM audit_logs al 
       JOIN users u ON al.operator_user_id = u.id 
       WHERE al.dispatch_id=$1 
       ORDER BY al.created_at ASC`, 
      [dispatchId]
    );
    
    res.json({ dispatch, bins, picks, logs });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------
// SCAN BIN QR
// ---------------------------------------------------------------
router.post('/:id/scan-bin', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;

  try {
    // 1. Parse the QR code using the utility
    const parsed = parseBinQR(rawQr);
    if (!parsed) return res.status(400).json({ message: 'Invalid Bin QR code' });

    // 2. Fetch the current state of the dispatch
    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dRows[0];

    // 3. VALIDATION STRATEGY (Now Async)
    // This calls the Strategy Registry -> nitera_1to1.js or usui_1toMany.js
    const validationResult = await runStrategy(dispatch, parsed, 'BIN_LABEL');
    
    if (!validationResult.ok) {
      // Log failure to audit table (Fire-and-forget)
      logAudit({
        dispatchId, 
        type: 'BIN_LABEL', 
        code: parsed.binNumber, 
        product_code: parsed.productCode,
        result: 'FAIL', 
        operator_user_id: req.user.id, 
        error_message: validationResult.message, 
        raw_qr: rawQr,
      }).catch(e => console.error('Audit log error:', e));

      return res.status(400).json({ message: validationResult.message });
    }

    // 4. REFERENCE SETTING (The "First Bin" Logic)
    // If this is the first bin being scanned, we set the reference values for all future scans
    const isFirstBin = !dispatch.ref_product_code;
    const totalBins = Math.ceil(parsed.supplyQty / parsed.casePack);

    if (isFirstBin) {
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
          parsed.supplyQty, 
          totalBins, 
          dispatchId
        ]
      );
    }

    // 5. DATA INSERTION
    // Insert the bin details into the dispatch_bins table
    await db.query(
      `INSERT INTO dispatch_bins 
       (dispatch_id, bin_number, product_code, case_pack, schedule_sent_date,
       schedule_number, supply_quantity, supply_date, vendor_code, invoice_number, product_name, unload_loc, raw_qr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        dispatchId, parsed.binNumber, parsed.productCode, parsed.casePack, parsed.scheduleSentDate,
        parsed.scheduleNumber, parsed.supplyQty, parsed.supplyDate, parsed.vendorCode,
        parsed.invoiceNumber, parsed.productName || null, parsed.unloadLoc || null, rawQr
      ]
    );

    // 6. QUANTITY UPDATE
    // Increment SMG (Bin) quantity and return the updated dispatch object
    const { rows: finalRows } = await db.query(
      `UPDATE dispatches SET smg_qty = smg_qty + 1, updated_at=now() WHERE id=$1 RETURNING *`,
      [dispatchId]
    );
    const finalDispatch = finalRows[0];

    // 7. SUCCESS AUDIT
    logAudit({
      dispatchId, type: 'BIN_LABEL', code: parsed.binNumber, product_code: parsed.productCode,
      result: 'PASS', operator_user_id: req.user.id, raw_qr: rawQr,
    }).catch(e => console.error('Audit log error:', e));

    res.json(finalDispatch);

  } catch (err) {
    // DUPLICATION CHECK: PostgreSQL error code 23505 is 'unique_violation'
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Bin already scanned for this dispatch' });
    }
    next(err);
  }
});

// ---------------------------------------------------------------
// SCAN PICK-LIST QR
// ---------------------------------------------------------------
router.post('/:id/scan-pick', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;

  try {
    // 1. Parse the Pick-list QR
    const parsed = parsePickQR(rawQr);
    if (!parsed) return res.status(400).json({ message: 'Invalid Pick QR code' });

    // 2. Fetch the current state of the dispatch
    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dRows[0];

    // 3. VALIDATION STRATEGY (Now Async)
    const validationResult = await runStrategy(dispatch, parsed, 'PICKLIST');
    
    if (!validationResult.ok) {
      // Log failure to audit table
      logAudit({
        dispatchId, type: 'PICKLIST', code: parsed.pickCode, product_code: parsed.productCode,
        result: 'FAIL', operator_user_id: req.user.id, error_message: validationResult.message, raw_qr: rawQr,
      }).catch(e => console.error('Audit log error:', e));

      return res.status(400).json({ message: validationResult.message });
    }

    // 4. DATA INSERTION
    // Insert the pick-list details into the dispatch_picks table
    await db.query(
      `INSERT INTO dispatch_picks (dispatch_id, pick_code, product_code, case_pack, raw_qr)
       VALUES ($1,$2,$3,$4,$5)`,
      [dispatchId, parsed.pickCode, parsed.productCode, parsed.casePack, rawQr]
    );

    // 5. QUANTITY UPDATE
    // Increment Bin (Pick) quantity and return updated dispatch
    const { rows: finalRows } = await db.query(
      `UPDATE dispatches SET bin_qty = bin_qty + 1, updated_at=now() WHERE id=$1 RETURNING *`,
      [dispatchId]
    );
    const finalDispatch = finalRows[0];

    // 6. SUCCESS AUDIT
    logAudit({
      dispatchId, type: 'PICKLIST', code: parsed.pickCode, product_code: parsed.productCode,
      result: 'PASS', operator_user_id: req.user.id, raw_qr: rawQr,
    }).catch(e => console.error('Audit log error:', e));

    res.json(finalDispatch);

  } catch (err) {
    // DUPLICATION CHECK: PostgreSQL error code 23505 for unique pick_code
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Pick code already scanned for this dispatch' });
    }
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
