// src/utils/qrParser.js

/**
 * Normalizes product codes for comparison.
 * Removes hyphens, removes 'M', converts to uppercase and trims.
 */
function normalizeCode(code) {
  if (!code) return '';
  return String(code)
    .replace(/-/g, '')
    .replace(/M/g, '')
    .toUpperCase()
    .trim();
}

/**
 * Normalizes various date formats to YYYY-MM-DD for database comparison.
 * Handles: "26/03/2026 07:30 PM", "26/03/26", "2026-03-26"
 */
function normalizeDate(dateStr) {
  if (!dateStr) return '';
  
  // Remove time part (everything after the first space)
  const dateOnly = String(dateStr).split(' ')[0].trim(); 
  
  // Case 1: DD/MM/YYYY or DD/MM/YY
  const dmyMatch = dateOnly.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (dmyMatch) {
    let day = dmyMatch[1].padStart(2, '0');
    let month = dmyMatch[2].padStart(2, '0');
    let year = dmyMatch[3];
    
    // Handle 2-digit year (e.g., "26" -> "2026")
    if (year.length === 2) year = '20' + year;
    
    return `${year}-${month}-${day}`; // Returns YYYY-MM-DD
  }
  
  // Case 2: Already in YYYY-MM-DD format
  return dateOnly;
}

function parseBinQR(raw) {
  try {
    const t = raw.trim();

    // 1. Bin Number - always 13 digits at the start
    const binMatch = t.match(/^(\d{13})/);
    // 2. Product Code - alphanumeric 8-15 chars after 2+ spaces
    const codeMatch = t.match(/\s{2,}([A-Z0-9]{8,15})\s/i);
    // 3. Case Pack - digits (2-4) after the product code block
    const cpMatch = t.match(/\s([A-Z0-9]{8,15})\s+(\d{2,4})\s/i);
    // 4. Product Name - between case pack and repeated bin number
    const nameMatch = t.match(/\s\d{2,4}\s{2,}([A-Z0-9,\/\s]+?)\d{13}/i);
    // 5+6+7. Date Block - SchedDate + Invoice + SupplyQty (Anchored to 'N')
    const dateBlock = t.match(/(\d{2}\/\d{2}\/\d{2,4})\s*(\d{8})\s*(\d{2,4})\s*N/);
    // 8. Vendor Code - N + 3 digits
    const vcMatch = t.match(/N(\d{3})/);
    // 9. Schedule Number - alphanumeric after vendor code
    const snMatch = t.match(/N\d{3}\s*([0-9A-Z]{10,20})\s*(?=[A-Z]{2}-)/i);
    // 10. Unload Location - 2 caps + dash + digits
    const ulMatch = t.match(/([A-Z]{2}-\d+)/i);
    // 11. Supply Date - dd/mm/yyyy HH:MM with optional AM/PM
    const sdMatch = t.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?:\s*[AP]M)?)/i);

    if (!binMatch || !codeMatch || !cpMatch) {
      throw new Error('Cannot parse Bin Label QR. Check format or use Manual input.');
    }

    const parsedCasePack = parseInt(cpMatch[2], 10);
    if (!parsedCasePack || parsedCasePack <= 0) {
      throw new Error(`Case Pack read as ${cpMatch[2]} — invalid. Check QR label.`);
    }

    if (!dateBlock) {
      throw new Error('Supply Quantity block not found. Rescan slowly and steadily.');
    }

    const parsedSupplyQty = parseInt(dateBlock[3], 10);
    if (!parsedSupplyQty || parsedSupplyQty <= 0) {
      throw new Error(`Supply Qty read as ${dateBlock[3]} — invalid. Rescan.`);
    }

    if (parsedSupplyQty % parsedCasePack !== 0) {
      throw new Error(`Supply Qty (${parsedSupplyQty}) ÷ Case Pack (${parsedCasePack}) = ${(parsedSupplyQty / parsedCasePack).toFixed(3)} bins — not a whole number.`);
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
    const pickMatch = t.match(/^(G\d+)/);
    const tokens = t.split(/\s+/).filter(s => s.length > 0);

    let productCode = null;
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      const noHyphen = token.replace(/-/g, '');
      if (/^[A-Z0-9-]{8,16}$/i.test(token) && /[A-Z]/i.test(noHyphen) && /[0-9]/.test(noHyphen)) {
        productCode = token;
        break;
      }
    }

    if (!pickMatch || !productCode) {
      throw new Error(`Picklist QR parse error: PickCode or ProductCode not found.`);
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
  normalizeDate,
};
