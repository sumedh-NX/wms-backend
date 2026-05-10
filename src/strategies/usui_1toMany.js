const { normalizeUsuiCode } = require('../utils/usuiParser');

module.exports = {
  name: 'Usui 1:Many Validation',

  validateNX: (nxCode) => {
    if (!nxCode || nxCode.trim().length < 5) {
      return { ok: false, message: 'Invalid NX QR Code' };
    }
    return { ok: true, productCode: normalizeUsuiCode(nxCode) };
  },

  validateBin: (nxProductCode, parsedBin) => {
    if (!nxProductCode) return { ok: false, message: 'NX Product not identified. Scan NX QR first.' };
    if (normalizeUsuiCode(parsedBin.productCode) !== normalizeUsuiCode(nxProductCode)) {
      return { ok: false, message: `Bin Product (${parsedBin.productCode}) does not match NX Product` };
    }
    return { ok: true };
  },

  validatePart: async (productCode, partCode, dispatchId, binId, db) => {
    const normProduct = normalizeUsuiCode(productCode);
    const normPart = normalizeUsuiCode(partCode);

    // PRODUCT A: 15730M54T00 (Count Only, No Dup Check)
    const isProductA = normProduct === normalizeUsuiCode('15730M54T00');
    
    if (!isProductA) {
      // Product B or C: Must contain the main product code
      if (!normPart.includes(normProduct)) {
        return { ok: false, message: 'Part code does not match Product identity' };
      }
      // Global Duplicate Check
      const { rows } = await db.query(
        `SELECT id FROM dispatch_parts WHERE part_code = $1 AND dispatch_id = $2`,
        [normPart, dispatchId]
      );
      if (rows.length > 0) {
        return { ok: false, message: 'This Part has already been scanned in this dispatch' };
      }
    }

    return { ok: true };
  }
};
