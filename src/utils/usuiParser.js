/**
 * usuiParser.js
 * Dedicated strictly to Usui 1:Many Workflow.
 * ZERO dependency on niteraParser or qrParser.
 */

/**
 * normalizeUsuiCode: Internal normalization for USUI only.
 * We keep this here so changes to Nitera normalization 
 * cannot possibly affect USUI.
 */
function normalizeUsuiCode(code) {
  if (!code) return '';
  return code
    .toUpperCase()
    .trim()
    .replace(/-/g, ''); // Usui specific normalization:’ just remove dashes and uppercase
}

function parseUsuiBin(raw) {
  try {
    const t = raw.trim();
    if (t.length < 20) return null;

    // 1. Bin Number: Fixed first 13 digits
    const binNumber = t.substring(0, 13);

    // 2. Product Code & Inside Parts
    const headMatch = t.match(/^\d{13}\s+([A-Z0-9]+)\s+(\d+)/i);
    if (!headMatch) return null;

    const productCode = headMatch[1];
    const insidePartCount = parseInt(headMatch[2]);

    // 3. Supply Quantity (The Positional Fix)
    // Logic: Find 'D' (Invoice start), skip 12 digits of invoice, 
    // capture all digits until we hit 'U' (Vendor code start).
    const qtyMatch = t.match(/D\d{13}(\d+?)U\d{3}/);
    const supplyQty = qtyMatch ? parseInt(qtyMatch[1]) : null;

    if (supplyQty === null) throw new Error('Could not extract Supply Quantity');

    // 4. Metadata
    const supplyDateMatch = t.match(/(\d{2}\/\d{2}\/\d{2})(?=\s*D\d{10})/);
    const invoiceMatch = t.match(/D(\d{12})/);
    const vendorCodeMatch = t.match(/U(\d{3})/);
    const scheduleMatch = t.match(/U\d{3}([0-9A-Z]{10,20})/);
    const nagareMatch = t.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s*[AP]M)/i);

    return {
      binNumber,
      productCode,
      insidePartCount,
      supplyQty,
      supplyDate: supplyDateMatch ? supplyDateMatch[1] : null,
      invoiceNumber: invoiceMatch ? invoiceMatch[1] : null,
      vendorCode: vendorCodeMatch ? vendorCodeMatch[1] : null,
      scheduleNumber: scheduleMatch ? scheduleMatch[1] : null,
      nagareTime: nagareMatch ? nagareMatch[1] : null,
    };
  } catch (err) {
    console.error("USUI Bin Parsing Error:", err);
    return null;
  }
}

function parseUsuiPart(raw) {
  return {
    raw: raw.trim(),
    normalized: normalizeUsuiCode(raw.trim()) // Uses the local isolated function
  };
}

module.exports = { parseUsuiBin, parseUsuiPart, normalizeUsuiCode };
