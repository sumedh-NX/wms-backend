/**
 * qrParser.js — Backend QR parser
 * Handles both single-line (spaces) and multi-line (newlines) bin label QR codes.
 *
 * QR Structure:
 * [BIN13] [PRODUCT_CODE] [CASE_PACK] [PRODUCT_NAME][BIN13_REPEAT][DD/MM/YY][INVOICE8][QTY][N][VENDOR3][SCHED_NUM][UNLOAD]...[DD/MM/YYYY HH:MM AM/PM]
 */

function parseBinQR(raw) {
  try {
    // Normalize: collapse all whitespace (newlines, tabs, multiple spaces) → single space
    const t = raw.trim().replace(/\s+/g, ' ');

    // 1. Bin number — first 13 digits
    const binMatch = t.match(/^(\d{13})/);
    if (!binMatch) throw new Error('No bin number found');
    const binNumber = binMatch[1];

    // 2. Product code — first token after bin number (8–15 alphanumeric chars)
    const afterBin = t.replace(/^\d{13}\s*/, '');
    const codeMatch = afterBin.match(/^([A-Z0-9]{8,15})\s/i);
    if (!codeMatch) throw new Error('No product code found');
    const productCode = codeMatch[1];

    // 3. Case pack — second token after bin number (2–4 digits)
    const cpMatch = afterBin.match(/^[A-Z0-9]{8,15}\s+(\d{2,4})\s/i);
    if (!cpMatch) throw new Error('No case pack found');
    const casePack = parseInt(cpMatch[1]);

    // 4. Date block — anchored to the SECOND occurrence of the 13-digit bin number
    //    Format: [BIN13][DD/MM/YY][INVOICE8][QTY2-4][N]
    //    Use \s* to handle both formats (space-separated or merged)
    const dateBlock = t.match(
      new RegExp(binNumber + '\\s*(\\d{2}\\/\\d{2}\\/\\d{2})\\s*(\\d{8})\\s*(\\d{2,4})\\s*N')
    );
    if (!dateBlock) throw new Error('No date block found');
    const scheduleSentDate = dateBlock[1]; // DD/MM/YY  e.g. 27/02/26
    const invoiceNumber    = dateBlock[2]; // 8-digit invoice
    const supplyQty        = parseInt(dateBlock[3]);

    // 5. Validate supply quantity divisible by case pack
    if (supplyQty % casePack !== 0) {
      throw new Error(`Supply qty ${supplyQty} not divisible by case pack ${casePack}`);
    }
    const totalBins = supplyQty / casePack;

    // 6. Vendor code — N followed by 3 digits
    const vcMatch = t.match(/N(\d{3})/);
    const vendorCode = vcMatch ? vcMatch[1] : null;

    // 7. Schedule number — after N+vendor, 10–20 alphanumeric chars before unload location
    const snMatch = t.match(/N\d{3}\s*([0-9A-Z]{10,20})\s*(?=[A-Z]{2}-)/i);
    const scheduleNumber = snMatch ? snMatch[1] : null;

    // 8. Unload location — pattern XX-NN
    const ulMatch = t.match(/([A-Z]{2}-\d+)/i);
    const unloadLocation = ulMatch ? ulMatch[1] : null;

    // 9. Supply date — full date+time e.g. "28/02/2026 03:30 PM"
    const sdMatch = t.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?:\s*[AP]M)?)/i);
    const supplyDate = sdMatch ? sdMatch[1] : null;

    return {
      binNumber,
      productCode,
      casePack,
      totalBins,
      supplyQty,
      scheduleSentDate, // DD/MM/YY  (Supply Date label)
      invoiceNumber,
      vendorCode,
      scheduleNumber,
      unloadLocation,
      supplyDate,       // DD/MM/YYYY HH:MM AM/PM  (Nagare Time label)
    };
  } catch (err) {
    return null;
  }
}

function normalizeCode(code) {
  if (!code) return '';
  return code.toUpperCase().replace(/-/g, '').replace(/^M/, '');
}

function parsePickQR(raw) {
  try {
    const t = raw.trim().replace(/\s+/g, ' ');
    // Picklist QR contains the product code somewhere
    const codeMatch = t.match(/([A-Z0-9]{8,15})/i);
    if (!codeMatch) return null;
    return { productCode: codeMatch[1] };
  } catch {
    return null;
  }
}

module.exports = { parseBinQR, parsePickQR, normalizeCode };