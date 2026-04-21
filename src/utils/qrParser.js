/**
 * qrParser.js — Backend QR parser
 * Handles both single-line and multi-line bin label QR codes,
 * and all 6 picklist QR formats.
 */

/**
 * Parse Bin Label QR
 * Structure: [BIN13] [PRODUCT_CODE] [CASE_PACK] [NAME][BIN13_REPEAT][DD/MM/YY][INVOICE8][QTY][N][VENDOR3][SCHED_NUM][UNLOAD]...[DD/MM/YYYY HH:MM AM/PM]
 */
function parseBinQR(raw) {
  try {
    const t = raw.trim().replace(/\s+/g, ' ');

    // 1. Bin number — first 13 digits
    const binMatch = t.match(/^(\d{13})/);
    if (!binMatch) throw new Error('No bin number found');
    const binNumber = binMatch[1];

    // 2. Product code — first token after bin number
    const afterBin = t.replace(/^\d{13}\s*/, '');
    const codeMatch = afterBin.match(/^([A-Z0-9]{8,15})\s/i);
    if (!codeMatch) throw new Error('No product code found');
    const productCode = codeMatch[1];

    // 3. Case pack — second token after bin number
    const cpMatch = afterBin.match(/^[A-Z0-9]{8,15}\s+(\d{2,4})\s/i);
    if (!cpMatch) throw new Error('No case pack found');
    const casePack = parseInt(cpMatch[1]);

    // 4. Date block — anchored to BIN13 repeat (prevents greedy year matching)
    const dateBlock = t.match(
      new RegExp(binNumber + '\\s*(\\d{2}\\/\\d{2}\\/\\d{2})\\s*(\\d{8})\\s*(\\d{2,4})\\s*N')
    );
    if (!dateBlock) throw new Error('No date block found');
    const scheduleSentDate = dateBlock[1]; // DD/MM/YY → Supply Date
    const invoiceNumber    = dateBlock[2];
    const supplyQty        = parseInt(dateBlock[3]);

    // 5. Validate divisibility
    if (supplyQty % casePack !== 0) {
      throw new Error(`Supply qty ${supplyQty} not divisible by case pack ${casePack}`);
    }
    const totalBins = supplyQty / casePack;

    // 6. Vendor code
    const vcMatch = t.match(/N(\d{3})/);
    const vendorCode = vcMatch ? vcMatch[1] : null;

    // 7. Schedule number
    const snMatch = t.match(/N\d{3}\s*([0-9A-Z]{10,20})\s*(?=[A-Z]{2}-)/i);
    const scheduleNumber = snMatch ? snMatch[1] : null;

    // 8. Unload location
    const ulMatch = t.match(/([A-Z]{2}-\d+)/i);
    const unloadLocation = ulMatch ? ulMatch[1] : null;

    // 9. Supply date full datetime → Nagare Time
    const sdMatch = t.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?:\s*[AP]M)?)/i);
    const supplyDate = sdMatch ? sdMatch[1] : null;

    return {
      binNumber,
      productCode,
      casePack,
      totalBins,
      supplyQty,
      scheduleSentDate, // DD/MM/YY  → ref_supply_date → "Supply Date"
      invoiceNumber,
      vendorCode,
      scheduleNumber,
      unloadLocation,
      supplyDate,       // DD/MM/YYYY HH:MM AM/PM → ref_schedule_sent_date → "Nagare Time"
    };
  } catch (err) {
    return null;
  }
}

/**
 * Parse Picklist QR
 * Structure: G[header_block] [PRODUCT_CODE] [ref_code] [lot] [qty] [qty2]
 * Product code appears after the G-header, may contain dashes (18213-74T10, 18640M-72R00)
 */
function parsePickQR(raw) {
  try {
    const t = raw.trim().replace(/\s+/g, ' ');

    // Skip the G-header (G + alphanumeric + underscores)
    // Product code is the first token after the header
    const afterHeader = t.replace(/^G[A-Z0-9_]+\s+/i, '');
    const codeMatch = afterHeader.match(/^([A-Z0-9]{5,6}-?[A-Z0-9]+(?:-[A-Z0-9]+)?)\s/i);
    if (!codeMatch) return null;

    return { productCode: codeMatch[1] };
  } catch {
    return null;
  }
}

/**
 * Normalize product code for comparison
 * Handles:
 *   - Bin QR:      18213M74T10  → 1821374T10
 *   - Picklist QR: 18213-74T10  → 1821374T10  (dash replaces M)
 *   - Bin QR:      18640M72R00  → 1864072R00
 *   - Picklist QR: 18640M-72R00 → 1864072R00  (has both M and dash)
 *   - Regular:     09482M00651  → 0948200651
 */
function normalizeCode(code) {
  if (!code) return '';
  return code
    .toUpperCase()
    .replace(/-/g, '')                    // remove all dashes
    .replace(/(?<=\d)M(?=\d)/g, '');      // remove M between digit sequences
}

module.exports = { parseBinQR, parsePickQR, normalizeCode };