const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../config/db');
const { permit } = require('../middleware/auth');
const { parseBinQR, parsePickQR } = require('../utils/niteraParser');
const { runStrategy } = require('../utils/strategyEngine');
const { logAudit } = require('../utils/auditLogger');

// ===============================================================================
// NITERA WORKFLOW: 1:1 Bin -> Pick Validation
// ===============================================================================

// POST /api/dispatch/:id/scan-bin
router.post('/:id/scan-bin', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  
  try {
    const parsed = parseBinQR(rawQr);
    if (!parsed) return res.status(400).json({ message: 'Invalid Nitera Bin QR' });
    
    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    const dispatch = dRows[0];
    
    const validationResult = await runStrategy(dispatch, parsed, 'BIN_LABEL');
    if (!validationResult.ok) {
      logAudit({ 
        dispatchId, type: 'BIN_LABEL', code: parsed.binNumber, 
        product_code: parsed.productCode, result: 'FAIL', 
        operator_user_id: req.user.id, error_message: validationResult.message, raw_qr: rawQr 
      }).catch(console.error);
      return res.status(400).json({ message: validationResult.message });
    }
    
    await db.query('BEGIN');
    try {
      if (!dispatch.ref_product_code) {
        const totalBins = Math.ceil(parsed.supplyQty / parsed.casePack);
        await db.query(
          `UPDATE dispatches SET ref_product_code=$1, ref_case_pack=$2, ref_supply_date=$3, 
           ref_schedule_sent_date=$4, ref_schedule_number=$5, supply_quantity=$6, 
           total_schedule_bins=$7, updated_at=now() WHERE id=$8`,
          [parsed.productCode, parsed.casePack, parsed.supplyDate, parsed.scheduleSentDate, 
           parsed.scheduleNumber, parsed.supplyQty, totalBins, dispatchId]
        );
      }
      
      await db.query(
        `INSERT INTO dispatch_bins (dispatch_id, bin_number, product_code, case_pack, 
         schedule_sent_date, schedule_number, supply_quantity, supply_date, vendor_code, 
         invoice_number, product_name, unload_loc, raw_qr) 
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [dispatchId, parsed.binNumber, parsed.productCode, parsed.casePack, 
         parsed.scheduleSentDate, parsed.scheduleNumber, parsed.supplyQty, parsed.supplyDate, 
         parsed.vendorCode, parsed.invoiceNumber, parsed.productName || null, 
         parsed.unloadLoc || null, rawQr]
      );
      
      const { rows: finalRows } = await db.query(
        `UPDATE dispatches SET smg_qty = smg_qty + 1, updated_at=now() WHERE id=$1 RETURNING *`, 
        [dispatchId]
      );
      
      await db.query('COMMIT');
      
      logAudit({ 
        dispatchId, type: 'BIN_LABEL', code: parsed.binNumber, 
        product_code: parsed.productCode, result: 'PASS', 
        operator_user_id: req.user.id, raw_qr: rawQr 
      }).catch(console.error);
      
      res.json(finalRows[0]);
    } catch (txErr) { 
      await db.query('ROLLBACK'); 
      throw txErr; 
    }
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Bin already scanned' });
    next(err);
  }
});

// POST /api/dispatch/:id/scan-pick
router.post('/:id/scan-pick', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  
  try {
    const parsed = parsePickQR(rawQr);
    if (!parsed) return res.status(400).json({ message: 'Invalid Nitera Pick QR' });
    
    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    const dispatch = dRows[0];
    
    const validationResult = await runStrategy(dispatch, parsed, 'PICKLIST');
    if (!validationResult.ok) {
      logAudit({ 
        dispatchId, type: 'PICKLIST', code: parsed.pickCode, 
        product_code: parsed.productCode, result: 'FAIL', 
        operator_user_id: req.user.id, error_message: validationResult.message, raw_qr: rawQr 
      }).catch(console.error);
      return res.status(400).json({ message: validationResult.message });
    }
    
    await db.query('BEGIN');
    try {
      await db.query(
        `INSERT INTO dispatch_picks (dispatch_id, pick_code, product_code, case_pack, raw_qr) 
         VALUES ($1,$2,$3,$4,$5)`, 
        [dispatchId, parsed.pickCode, parsed.productCode, parsed.casePack, rawQr]
      );
      
      const { rows: finalRows } = await db.query(
        `UPDATE dispatches SET bin_qty = bin_qty + 1, updated_at=now() WHERE id=$1 RETURNING *`, 
        [dispatchId]
      );
      
      // Check Nitera completion
      const finalDispatch = finalRows[0];
      if (finalDispatch.smg_qty === finalDispatch.total_schedule_bins && 
          finalDispatch.bin_qty === finalDispatch.total_schedule_bins) {
        await db.query(`UPDATE dispatches SET status='COMPLETED' WHERE id=$1`, [dispatchId]);
        finalDispatch.status = 'COMPLETED';
      }
      
      await db.query('COMMIT');
      
      logAudit({ 
        dispatchId, type: 'PICKLIST', code: parsed.pickCode, 
        product_code: parsed.productCode, result: 'PASS', 
        operator_user_id: req.user.id, raw_qr: rawQr 
      }).catch(console.error);
      
      res.json(finalDispatch);
    } catch (txErr) { 
      await db.query('ROLLBACK'); 
      throw txErr; 
    }
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Pick already scanned' });
    next(err);
  }
});

module.exports = router;