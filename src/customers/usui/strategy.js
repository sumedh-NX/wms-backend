const { normalizeUsuiCode } = require('./parser');

module.exports = {
  name: 'Usui 1:Many Validation',

  validateNX: (nxCode) => {
    if (!nxCode) return { ok: false, message: 'NX QR Code is empty' };

    const trimmedCode = nxCode.trim();

    if (/^\d{13}/.test(trimmedCode)) {
      return { ok: false, message: 'Invalid Scan: You scanned a Bin QR, but an NX Product QR is required here.' };
    }

    if (trimmedCode.length > 30) {
      return { ok: false, message: 'Invalid Scan: This code is too long to be a Product NX code.' };
    }

    if (trimmedCode.length < 5) {
      return { ok: false, message: 'Invalid NX QR Code: Code is too short.' };
    }

    return { ok: true, productCode: normalizeUsuiCode(trimmedCode) };
  },

  validateBin: (nxProductCode, parsedBin, dispatch) => {
    if (!nxProductCode) {
      return { ok: false, message: 'NX Product not identified. Scan NX QR first.' };
    }

    if (normalizeUsuiCode(parsedBin.productCode) !== normalizeUsuiCode(nxProductCode)) {
      return { ok: false, message: `Bin Product (${parsedBin.productCode}) does not match NX Product (${nxProductCode})` };
    }

    if (dispatch.ref_schedule_number) {
      if (!parsedBin.scheduleNumber) {
        return { ok: false, message: 'Could not extract Schedule No from Bin QR. Please check the label.' };
      }
      if (parsedBin.scheduleNumber.trim() !== dispatch.ref_schedule_number.trim()) {
        return { ok: false, message: `Schedule No mismatch: Bin has (${parsedBin.scheduleNumber}) but dispatch reference is (${dispatch.ref_schedule_number})` };
      }
    }

    return { ok: true };
  },

  validatePart: async (productCode, partCode, dispatchId, binId, db) => {
    const normProduct = normalizeUsuiCode(productCode);
    const normPart    = normalizeUsuiCode(partCode);

    const isProductA = normProduct === normalizeUsuiCode('15730M54T00');

    if (!isProductA) {
      if (normPart === normProduct) {
        return { ok: false, message: 'Invalid: This is the master Product QR, not an inside Part QR' };
      }

      if (!normPart.includes(normProduct)) {
        return { ok: false, message: 'Part code does not match Product identity' };
      }

      const productIndex = normPart.indexOf(normProduct);
      const hasDataBefore = productIndex > 0;
      const hasDataAfter  = (productIndex + normProduct.length) < normPart.length;

      if (!hasDataBefore) {
        return { ok: false, message: 'Invalid Part QR: missing prefix data (e.g., vendor code)' };
      }

      if (!hasDataAfter) {
        return { ok: false, message: 'Invalid Part QR: missing suffix data (e.g., serial/date)' };
      }

      const { rows } = await db.query(
        `SELECT id FROM dispatch_parts WHERE part_code = $1 AND dispatch_id = $2`,
        [normPart, dispatchId]
      );
      if (rows.length > 0) {
        return { ok: false, message: 'This Part has already been scanned in this dispatch' };
      }
    }

    return { ok: true };
  },
};
