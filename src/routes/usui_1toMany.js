const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../config/db');
const { permit } = require('../middleware/auth');
const { parseUsuiBin, parseUsuiPart } = require('../utils/usuiParser');
const { resolveStrategyCode } = require('../utils/strategyEngine');
const { getStrategy } = require('../strategies');
const { logAudit } = require('../utils/auditLogger');

// ===============================================================================
// USUI WORKFLOW: NX -> Bin -> Parts Validation
// ===============================================================================

// POST /api/dispatch/:id/scan-nx
router.post('/:id/scan-nx', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;

  try {
    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dRows[0];

    const strategyCode = await resolveStrategyCode(dispatch.customer_id);
    if (!strategyCode) return res.status(400).json({ message: 'No strategy assigned' });

    const strategyLogic = getStrategy(strategyCode);
    const val = strategyLogic.validateNX(rawQr);

    if (!val.ok) {
      logAudit({
        dispatchId, type: 'NX_QR', code: rawQr.substring(0, 50),
        result: 'FAIL', operator_user_id: req.user.id,
        error_message: val.message, raw_qr: rawQr
      }).catch(console.error);
      return res.status(400).json({ message: val.message });
    }

    const { rows: updated } = await db.query(
      `UPDATE dispatches SET ref_product_code = $1, updated_at=now() WHERE id=$2 RETURNING *`,
      [val.productCode, dispatchId]
    );

    logAudit({
      dispatchId, type: 'NX_QR',
      code: val.productCode,
      product_code: val.productCode,
      result: 'PASS',
      operator_user_id: req.user.id,
      raw_qr: rawQr
    }).catch(console.error);

    res.json({ dispatch: updated[0], productCode: val.productCode });
  } catch (err) { next(err); }
});

// POST /api/dispatch/:id/scan-bin-usui
router.post('/:id/scan-bin-usui', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr } = req.body;
  let parsed;

  try {
    parsed = parseUsuiBin(rawQr);
    if (!parsed) {
      logAudit({
        dispatchId, type: 'BIN_LABEL',
        code: rawQr.substring(0, 50),
        product_code: null,
        result: 'FAIL',
        operator_user_id: req.user.id,
        error_message: 'Invalid USUI Bin QR',
        raw_qr: rawQr
      }).catch(console.error);
      return res.status(400).json({ message: 'Invalid USUI Bin QR' });
    }

    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dRows[0];

    const strategyCode = await resolveStrategyCode(dispatch.customer_id);
    const strategyLogic = getStrategy(strategyCode);

    const val = strategyLogic.validateBin(dispatch.ref_product_code, parsed, dispatch);
    if (!val.ok) {
      logAudit({
        dispatchId, type: 'BIN_LABEL', code: parsed.binNumber,
        product_code: parsed.productCode, result: 'FAIL',
        operator_user_id: req.user.id, error_message: val.message, raw_qr: rawQr
      }).catch(console.error);
      return res.status(400).json({ message: val.message });
    }

    const { rows: dup } = await db.query(
      `SELECT id FROM dispatch_bins WHERE bin_number = $1 AND dispatch_id = $2`,
      [parsed.binNumber, dispatchId]
    );
    if (dup.length > 0) {
      logAudit({
        dispatchId, type: 'BIN_LABEL', code: parsed.binNumber,
        product_code: parsed.productCode, result: 'FAIL',
        operator_user_id: req.user.id,
        error_message: 'Bin already scanned',
        raw_qr: rawQr
      }).catch(console.error);
      return res.status(409).json({ message: 'Bin already scanned' });
    }

    await db.query('BEGIN');
    try {
      const { rows: binRow } = await db.query(
        `INSERT INTO dispatch_bins (dispatch_id, bin_number, product_code, case_pack,
         supply_quantity, supply_date, raw_qr)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [dispatchId, parsed.binNumber, parsed.productCode, parsed.insidePartCount,
         parsed.supplyQty, parsed.supplyDate, rawQr]
      );

      const totalBatchBins = Math.ceil(parsed.supplyQty / parsed.insidePartCount);
      let finalRows;

      if (!dispatch.ref_case_pack) {
        const result = await db.query(
          `UPDATE dispatches SET
          smg_qty = smg_qty + 1,
          total_schedule_bins = $1,
          ref_case_pack = $2,
          ref_schedule_number = $3,
          ref_supply_date = $4,
          ref_schedule_sent_date = $5,
          supply_quantity = $6,
          updated_at = now()
          WHERE id = $7 RETURNING *`,
          [totalBatchBins, parsed.insidePartCount, parsed.scheduleNumber,
           parsed.nagareTime, parsed.supplyDate, parsed.supplyQty, dispatchId]
        );
        finalRows = result.rows;
      } else {
        const result = await db.query(
          `UPDATE dispatches SET
          smg_qty = smg_qty + 1,
          total_schedule_bins = $1,
          updated_at = now()
          WHERE id = $2 RETURNING *`,
          [totalBatchBins, dispatchId]
        );
        finalRows = result.rows;
      }

      await db.query('COMMIT');

      logAudit({
        dispatchId, type: 'BIN_LABEL', code: parsed.binNumber,
        product_code: parsed.productCode, result: 'PASS',
        operator_user_id: req.user.id, raw_qr: rawQr
      }).catch(console.error);

      res.json({
        dispatch: finalRows[0],
        binId: binRow[0].id,
        requiredParts: parsed.insidePartCount
      });
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }
  } catch (err) { next(err); }
});

// POST /api/dispatch/:id/scan-part
router.post('/:id/scan-part', permit('operator', 'supervisor', 'admin'), async (req, res, next) => {
  const dispatchId = req.params.id;
  const { rawQr, binId } = req.body;
  let parsedPart;

  try {
    parsedPart = parseUsuiPart(rawQr);
    if (!parsedPart) {
      logAudit({
        dispatchId, type: 'PART',
        code: rawQr.substring(0, 50),
        product_code: null,
        result: 'FAIL',
        operator_user_id: req.user.id,
        error_message: 'Invalid USUI Part QR',
        raw_qr: rawQr
      }).catch(console.error);
      return res.status(400).json({ message: 'Invalid USUI Part QR' });
    }

    const { rows: dRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);
    if (dRows.length === 0) return res.status(404).json({ message: 'Dispatch not found' });
    const dispatch = dRows[0];

    const strategyCode = await resolveStrategyCode(dispatch.customer_id);
    const strategyLogic = getStrategy(strategyCode);

    const val = await strategyLogic.validatePart(
      dispatch.ref_product_code, parsedPart.normalized, dispatchId, binId, db
    );

    if (!val.ok) {
      logAudit({
        dispatchId, type: 'PART', code: parsedPart.normalized.substring(0, 50),
        product_code: dispatch.ref_product_code, result: 'FAIL',
        operator_user_id: req.user.id, error_message: val.message, raw_qr: rawQr
      }).catch(console.error);
      return res.status(400).json({ message: val.message });
    }

    await db.query('BEGIN');
    try {
      await db.query(
        `INSERT INTO dispatch_parts (dispatch_id, bin_id, part_code, raw_qr)
         VALUES ($1,$2,$3,$4)`,
        [dispatchId, binId, parsedPart.normalized, rawQr]
      );

      const { rows: countRows } = await db.query(
        `SELECT
           COUNT(*) FILTER (WHERE bin_id = $1) as bin_count,
           COUNT(*) as total_count
         FROM dispatch_parts
         WHERE dispatch_id = $2`,
        [binId, dispatchId]
      );

      const binCount = parseInt(countRows[0].bin_count);
      const totalScanned = parseInt(countRows[0].total_count);
      const expectedTotal = dispatch.total_schedule_bins * dispatch.ref_case_pack;

      if (totalScanned >= expectedTotal) {
        await db.query(
          `UPDATE dispatches SET status = 'COMPLETED', updated_at=now() WHERE id = $1`,
          [dispatchId]
        );
      }

      await db.query('COMMIT');

      const { rows: finalRows } = await db.query(`SELECT * FROM dispatches WHERE id=$1`, [dispatchId]);

      logAudit({
        dispatchId, type: 'PART', code: parsedPart.normalized.substring(0, 50),
        product_code: dispatch.ref_product_code, result: 'PASS',
        operator_user_id: req.user.id, raw_qr: rawQr
      }).catch(console.error);

      res.json({
        count: binCount,
        partCode: parsedPart.normalized,
        dispatch: finalRows[0]
      });
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    if (err.code === '23505') {
      logAudit({
        dispatchId, type: 'PART',
        code: parsedPart?.normalized?.substring(0, 50) || rawQr.substring(0, 50),
        product_code: null,
        result: 'FAIL',
        operator_user_id: req.user.id,
        error_message: 'Part already scanned',
        raw_qr: rawQr
      }).catch(console.error);
      return res.status(409).json({ message: 'Part already scanned' });
    }
    next(err);
  }
});

module.exports = router;