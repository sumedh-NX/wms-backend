/**
 * usuiParser.js
 * Dedicated strictly to Usui 1:Many Workflow.
 */

function normalizeUsuiCode(code) {
  if (!code) return '';
  // Usui normalization: Uppercase and Trim only, 
  // as we need to preserve identity for Product B/C checks.
  return code.toUpperCase().trim();
}

function parseUsuiBin(raw) {
  try {
    const t = raw.trim();
    const binNumber = t.substring(0, 13);
    
    const pattern = /^\d{13}\s+([A-Z0-9]+)\s+(\d+)\s+([A-Z\s,]+)/i;
    const match = t.match(pattern);
    if (!match) return null;

    const productCode = match[1];
    const insidePartCount = parseInt(match[2]);
    const productName = match[3].trim();

    const supplyDateMatch = t.match(/(\d{2}\/\d{2}\/\d{2})(?=\s*D\d{10})/);
    const invoiceMatch = t.match(/D(\d{10,12})/);
    const supplyQtyMatch = t.match(/(\d{2,4})(?=U\d{3})/);
    const vendorCodeMatch = t.match(/U(\d{3})/);
    const scheduleMatch = t.match(/U\d{3}([0-9A-Z]{10,20})/);
    const nagareMatch = t.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s*[AP]M)/i);

    return {
      binNumber,
      productCode,
      insidePartCount,
      productName,
      supplyDate: supplyDateMatch ? supplyDateMatch[1] : null,
      invoiceNumber: invoiceMatch ? invoiceMatch[1] : null,
      supplyQty: supplyQtyMatch ? parseInt(supplyQtyMatch[1]) : null,
      vendorCode: vendorCodeMatch ? vendorCodeMatch[1] : null,
      scheduleNumber: scheduleMatch ? scheduleMatch[1] : null,
      nagareTime: nagareMatch ? nagareMatch[1] : null,
    };
  } catch (err) {
    return null;
  }
}

function parseUsuiPart(raw) {
  return {
    raw: raw.trim(),
    normalized: normalizeUsuiCode(raw.trim())
  };
}

module.exports = { parseUsuiBin, parseUsuiPart, normalizeUsuiCode };
