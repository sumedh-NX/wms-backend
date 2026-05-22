function normalizeUsuiCode(code) {
  if (!code) return '';
  return code
    .toUpperCase()
    .trim()
    .replace(/-/g, '');
}

function parseUsuiBin(raw) {
  try {
    const t = raw.trim();
    if (t.length < 20) return null;

    const binNumber = t.substring(0, 13);

    const headMatch = t.match(/^\d{13}\s+([A-Z0-9]+)\s+(\d+)/i);
    if (!headMatch) return null;

    const productCode     = headMatch[1];
    const insidePartCount = parseInt(headMatch[2]);

    const qtyMatch = t.match(/D\d{12}(\d+?)U\d{3}/);
    const supplyQty = qtyMatch ? parseInt(qtyMatch[1]) : null;

    if (supplyQty === null) throw new Error('Could not extract Supply Quantity');

    const supplyDateMatch  = t.match(/(\d{2}\/\d{2}\/\d{2})(?=\s*D\d{12})/);
    const invoiceMatch     = t.match(/D(\d{12})/);
    const vendorCodeMatch  = t.match(/U(\d{3})/);
    const scheduleMatch    = t.match(/U\d{3}([0-9A-Z]+)(?=PE-\d)/i);
    const nagareMatch      = t.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s*[AP]M)(?=[^a-z])/);

    return {
      binNumber,
      productCode,
      insidePartCount,
      supplyQty,
      supplyDate:     supplyDateMatch ? supplyDateMatch[1] : null,
      invoiceNumber:  invoiceMatch    ? invoiceMatch[1]    : null,
      vendorCode:     vendorCodeMatch ? vendorCodeMatch[1] : null,
      scheduleNumber: scheduleMatch   ? scheduleMatch[1]  : null,
      nagareTime:     nagareMatch     ? nagareMatch[1]    : null,
    };
  } catch (err) {
    console.error('USUI Bin Parsing Error:', err);
    return null;
  }
}

function parseUsuiPart(raw) {
  return {
    raw:        raw.trim(),
    normalized: normalizeUsuiCode(raw.trim()),
  };
}

module.exports = { parseUsuiBin, parseUsuiPart, normalizeUsuiCode };
