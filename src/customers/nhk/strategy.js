const { normalizeNhkCode } = require('./parser');

const PARTS_PER_BIN = 5;

module.exports = {
  name: 'NHK Springs 1:Many Validation',

  validateNX: (rawQr) => {
    if (!rawQr) return { ok: false, message: 'NX Kanban is empty' };

    const trimmed = rawQr.trim();

    if (/^\d{13}/.test(trimmed)) {
      return { ok: false, message: 'Invalid Scan: You scanned a Bin QR, but an NX Kanban is required here.' };
    }

    if (trimmed.split(/\s+/).length === 6) {
      return { ok: false, message: 'Invalid Scan: You scanned a Part QR, but an NX Kanban is required here.' };
    }

    if (trimmed.length < 5) {
      return { ok: false, message: 'Invalid NX Kanban: Code is too short.' };
    }

    return { ok: true, productCode: normalizeNhkCode(trimmed) };
  },

  validateBin: (nxProductCode, parsedBin, dispatch) => {
    if (!nxProductCode) {
      return { ok: false, message: 'NX Kanban not scanned. Scan NX Kanban first.' };
    }

    if (normalizeNhkCode(parsedBin.productCode) !== normalizeNhkCode(nxProductCode)) {
      return {
        ok: false,
        message: `Bin Product (${parsedBin.productCode}) does not match NX Product (${nxProductCode})`,
      };
    }

    if (dispatch.ref_schedule_number) {
      if (!parsedBin.scheduleNumber) {
        return { ok: false, message: 'Could not extract Schedule No from Bin QR. Please check the label.' };
      }
      if (parsedBin.scheduleNumber.trim() !== dispatch.ref_schedule_number.trim()) {
        return {
          ok: false,
          message: `Schedule No mismatch: Bin has (${parsedBin.scheduleNumber}) but dispatch reference is (${dispatch.ref_schedule_number})`,
        };
      }
    }

    return { ok: true };
  },

  validatePart: async (productCode, parsedPart, dispatchId, binId, db) => {
    if (normalizeNhkCode(parsedPart.productCode) !== normalizeNhkCode(productCode)) {
      return {
        ok: false,
        message: `Part Product (${parsedPart.productCode}) does not match dispatch Product (${productCode})`,
      };
    }

    const { rows: dupRows } = await db.query(
      `SELECT id FROM dispatch_parts WHERE part_code = $1 AND dispatch_id = $2`,
      [parsedPart.raw, dispatchId]
    );
    if (dupRows.length > 0) {
      return { ok: false, message: 'This Part has already been scanned in this dispatch' };
    }

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS count FROM dispatch_parts WHERE bin_id = $1`,
      [binId]
    );
    if (parseInt(countRows[0].count) >= PARTS_PER_BIN) {
      return { ok: false, message: `This bin already has ${PARTS_PER_BIN} parts scanned. Scan the next Bin.` };
    }

    return { ok: true };
  },
};