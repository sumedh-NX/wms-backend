// src/utils/qrParser.js

/**
 * Normalizes product codes for comparison.
 * Removes hyphens, removes 'M', converts to uppercase and trims.
 * Example: "18213-74T10" -> "1821374T10"
 * Example: "09482M00651" -> "0948200651"
 */
function normalizeCode(code) {
  if (!code) return '';
  return String(code)
    .replace(/-/g, '')
    .replace(/M/g, '')
    .toUpperCase()
    .trim();
}

function parseBinQR(raw) {
  try {
    const t = raw.trim();

    const binMatch = t.match(/^(\d{13})/);
    const codeMatch = t.match(/\s{2,}([A-Z0-9]{8,15})\s/i);
    const cpMatch = t.match(/\s([A-Z0-9]{8,15})\s+(\d{2,4})\s/i);
    const nameMatch = t.match(/\s\d{2,4}\s{2,}([A-Z0-9,\/\s]+?)\d{13}/i);
    
    // IMPROVED: Strict anchoring to the date-invoice-qty block
    // This handles "03/04/2692600165960N" perfectly
    const dateBlock = t.match(/(\d{2}\/\d{2}\/\d{2})\s*(\d{8})\s*(\d{2,4})\s*N/);
    
    const vcMatch = t.match(/N(\d{3})/);
    const snMatch = t.match(/N\d{3}\s*([0-9A-Z]{10,20})\s*(?=[A-Z]{2}-)/i);
    const ulMatch = t.match(/([A-Z]{2}-\d+)/i);
    const sdMatch = t.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?:\s*[AP]M)?)/i);

    if (!binMatch || !codeMatch || !cpMatch) {
      throw new Error('Cannot parse Bin Label QR. Check format.');
    }

    const parsedCasePack = parseInt(cpMatch[2], 10);
    if (isNaN(parsedCasePack) || parsedCasePack <= 0) {
      throw new Error(`Invalid Case Pack: ${cpMatch[2]}`);
    }

    if (!dateBlock) {
      throw new Error('Supply Quantity block not found. Rescan.');
    }

    const parsedSupplyQty = parseInt(dateBlock[3], 10);
    if (isNaN(parsedSupplyQty) || parsedSupplyQty <= 0) {
      throw new Error(`Invalid Supply Qty: ${dateBlock[3]}`);
    }

    // STRICT MATH: Must be a whole number
    if (parsedSupplyQty % parsedCasePack !== 0) {
      throw new Error(`Supply Qty (${parsedSupplyQty}) must be divisible by Case Pack (${parsedCasePack}).`);
    }

    return {
      binNumber: binMatch[1].trim(),
      productCode: codeMatch[1].trim(),
      casePack: parsedCasePack,
      productName: nameMatch ? nameMatch[1].trim() : '',
      scheduleSentDate: dateBlock ? dateBlock[1].trim() : '',
      invoiceNumber: dateBlock ? dateBlock[2].trim() : '',
      supplyQty: parsedSupplyQty,
      vendorCode: vcMatch ? vcMatch[1].trim() : '',
      scheduleNumber: snMatch ? snMatch[1].trim() : '',
      unloadLoc: ulMatch ? ulMatch[1].trim() : '',
      supplyDate: sdMatch ? sdMatch[1].trim() : '',
      raw: raw
    };
  } catch (e) {
    throw e;
  }
}


function parsePickQR(raw) {
  try {
    const t = raw.trim();

    // Pick Code - G followed by digits (underscore not required)
    const pickMatch = t.match(/^(G\d+)/);
    const tokens = t.split(/\s+/).filter(s => s.length > 0);

    let productCode = null;
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      const noHyphen = token.replace(/-/g, '');
      // Must be alphanumeric 8-16 chars, and contain BOTH letters and digits
      if (/^[A-Z0-9-]{8,16}$/i.test(token) && /[A-Z]/i.test(noHyphen) && /[0-9]/.test(noHyphen)) {
        productCode = token;
        break;
      }
    }

    if (!pickMatch || !productCode) {
      const debug = `PickCode: ${pickMatch ? pickMatch[1] : 'NOT FOUND'} | Code: ${productCode || 'NOT FOUND'}`;
      throw new Error(`Picklist QR parse error: ${debug}`);
    }

    return {
      pickCode: pickMatch[1].trim(),
      productCode: productCode.trim(),
      raw: raw
    };
  } catch (e) {
    throw e;
  }
}

module.exports = {
  parseBinQR,
  parsePickQR,
  normalizeCode,
};
