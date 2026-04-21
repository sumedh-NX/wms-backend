/**
 * qrParser.js — Backend QR parser
 * Handles both single-line and multi-line bin label QR codes,
 * and all 6 picklist QR formats.
 */

function parseBinQR(raw) {
  try {
    const t = raw.trim().replace(/\s+/g, ' ');

    const binMatch = t.match(/^(\d{13})/);
    if (!binMatch) throw new Error('No bin number found');
    const binNumber = binMatch[1];

    const afterBin = t.replace(/^\d{13}\s*/, '');
    const codeMatch = afterBin.match(/^([A-Z0-9]{8,15})\s/i);
    if (!codeMatch) throw new Error('No product code found');
    const productCode = codeMatch[1];

    const cpMatch = afterBin.match(/^[A-Z0-9]{8,15}\s+(\d{2,4})\s/i);
    if (!cpMatch) throw new Error('No case pack found');
    const casePack = parseInt(cpMatch[1]);

    const dateBlock = t.match(
      new RegExp(binNumber + '\\s*(\\d{2}\\/\\d{2}\\/\\d{2})\\s*(\\d{8})\\s*(\\d{2,4})\\s*N')
    );
    if (!dateBlock) throw new Error('No date block found');
    const scheduleSentDate = dateBlock[1];
    const invoiceNumber    = dateBlock[2];
    const supplyQty        = parseInt(dateBlock[3]);

    if (supplyQty % casePack !== 0) {
      throw new Error(`Supply qty ${supplyQty} not divisible by case pack ${casePack}`);
    }
    const totalBins = supplyQty / casePack;

    const vcMatch = t.match(/N(\d{3})/);
    const vendorCode = vcMatch ? vcMatch[1] : null;

    const snMatch = t.match(/N\d{3}\s*([0-9A-Z]{10,20})\s*(?=[A-Z]{2}-)/i);
    const scheduleNumber = snMatch ? snMatch[1] : null;

    const ulMatch = t.match(/([A-Z]{2}-\d+)/i);
    const unloadLocation = ulMatch ? ulMatch[1] : null;

    const sdMatch = t.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?:\s*[AP]M)?)/i);
    const supplyDate = sdMatch ? sdMatch[1] : null;

    return {
      binNumber,
      productCode,
      casePack,
      totalBins,
      supplyQty,
      scheduleSentDate,
      invoiceNumber,
      vendorCode,
      scheduleNumber,
      unloadLocation,
      supplyDate,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Parse Picklist QR
 * Returns pickCode (G-header), productCode, and casePack
 * as required by dispatch_picks INSERT in dispatch.js
 */
function parsePickQR(raw) {
  try {
    const t = raw.trim().replace(/\s+/g, ' ');

    // pickCode = the full G-header token (unique pick identifier)
    const pickCodeMatch = t.match(/^(G\S+)/i);
    if (!pickCodeMatch) return null;
    const pickCode = pickCodeMatch[1];

    // productCode = first token after the G-header (may contain dashes)
    const afterHeader = t.replace(/^G[A-Z0-9_]+\s+/i, '');
    const codeMatch = afterHeader.match(/^([A-Z0-9]{5,6}-?[A-Z0-9]+(?:-[A-Z0-9]+)?)\s/i);
    if (!codeMatch) return null;
    const productCode = codeMatch[1];

    // casePack = last numeric token (e.g. 0000120 → 120)
    const qtyMatch = t.match(/(\d{4,7})\s*$/);
    const casePack = qtyMatch ? parseInt(qtyMatch[1]) : null;

    return { pickCode, productCode, casePack };
  } catch {
    return null;
  }
}

/**
 * Normalize product code for comparison between bin and picklist QRs
 * Bin QR:      18213M74T10  → 1821374T10
 * Picklist QR: 18213-74T10  → 1821374T10
 * Bin QR:      18640M72R00  → 1864072R00
 * Picklist QR: 18640M-72R00 → 1864072R00
 * Regular:     09482M00651  → 0948200651
 */
function normalizeCode(code) {
  if (!code) return '';
  return code
    .toUpperCase()
    .replace(/-/g, '')
    .replace(/(?<=\d)M(?=\d)/g, '');
}

module.exports = { parseBinQR, parsePickQR, normalizeCode };
