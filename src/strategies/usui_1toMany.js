const { normalizeUsuiCode } = require('../utils/usuiParser');

module.exports = {
  name: 'Usui 1:Many Validation',

  validateNX: (nxCode) => {
    if (!nxCode) return { ok: false, message: 'NX QR Code is empty' };
    
    const trimmedCode = nxCode.trim();

    // 1. REJECT if it looks like a Bin QR (Starts with 13 digits)
    if (/^\d{13}/.test(trimmedCode)) {
      return { ok: false, message: 'Invalid Scan: You scanned a Bin QR, but an NX Product QR is required here.' };
    }

    // 2. REJECT if it's too long (Product codes are usually 10-20 chars, Bin QRs are 100+)
    if (trimmedCode.length > 30) {
      return { ok: false, message: 'Invalid Scan: This code is too long to be a Product NX code.' };
    }

    // 3. REJECT if it's too short
    if (trimmedCode.length < 5) {
      return { ok: false, message: 'Invalid NX QR Code: Code is too short.' };
    }

    // If it passes these guards, it's likely a real Product Code
    return { 
      ok: true, 
      productCode: normalizeUsuiCode(trimmedCode) 
    };
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

  // PRODUCT A: 15730M54T00 (Count Only, No Match, No Dup Check)
  const isProductA = normProduct === normalizeUsuiCode('15730M54T00');
  
  if (!isProductA) {
    // RULE 1: Reject if part QR is identical to the product code
    if (normPart === normProduct) {
      return { ok: false, message: 'Invalid: This is the master Product QR, not an inside Part QR' };
    }
    
    // RULE 2: Part must contain the product code
    if (!normPart.includes(normProduct)) {
      return { ok: false, message: 'Part code does not match Product identity' };
    }
    
    // RULE 3: Part must have data BOTH before AND after the product code
    const productIndex = normPart.indexOf(normProduct);
    const hasDataBefore = productIndex > 0;
    const hasDataAfter = (productIndex + normProduct.length) < normPart.length;
    
    if (!hasDataBefore) {
      return { ok: false, message: 'Invalid Part QR: missing prefix data (e.g., vendor code)' };
    }
    
    if (!hasDataAfter) {
      return { ok: false, message: 'Invalid Part QR: missing suffix data (e.g., serial/date)' };
    }
    
    // RULE 4: Global Duplicate Check across the dispatch
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
