function normalizeNhkCode(code) {
  if (!code) return '';
  return code.toUpperCase().trim().replace(/-/g, '');
}

function parseNhkBin(raw) {
  try {
    // Debug: log the raw input showing non-printable characters
    console.log('[NHK BIN] raw length:', raw?.length, 'hex preview:', Buffer.from(raw || '').slice(0, 80).toString('hex'));

    // Try multiple line separators — NHK scanners have been seen to use \r, \r\n, or \n
    let lines = raw.split(/\r\n|\r|\n/);

    // If the entire QR arrived as one blob (no newlines), log and bail early so the
    // error message is predictable.
    console.log('[NHK BIN] line count after split:', lines.length, 'line[0]:', JSON.stringify(lines[0]?.slice(0, 30)));

    const binNumber = lines[0]?.trim();
    if (!binNumber || !/^\d{13}$/.test(binNumber)) {
      console.log('[NHK BIN] FAIL binNumber check:', JSON.stringify(binNumber));
      return null;
    }

    const productCode = lines[2]?.trim();
    if (!productCode) {
      console.log('[NHK BIN] FAIL productCode empty, lines[2]:', JSON.stringify(lines[2]));
      return null;
    }

    const casePack = parseInt(lines[3]?.trim());
    if (isNaN(casePack)) {
      console.log('[NHK BIN] FAIL casePack NaN, lines[3]:', JSON.stringify(lines[3]));
      return null;
    }

    const productName     = lines[4]?.trim()  || null;
    const supplyDate      = lines[6]?.trim()  || null;
    const invoiceNumber   = lines[9]?.trim()  || null;
    const totalSupplyQty  = parseInt(lines[10]?.trim()) || null;
    const destinationCode = lines[11]?.trim() || null;
    const scheduleNumber  = lines[12]?.trim() || null;
    const unloadLocation  = lines[13]?.trim() || null;

    // Bin sequence "X/Y" — total bins = denominator (Y)
    const seqStr   = lines[14]?.trim() || '';
    const seqMatch = seqStr.match(/^(\d+)\/(\d+)$/);
    const totalBins = seqMatch ? parseInt(seqMatch[2]) : null;

    const vendorName       = lines[15]?.trim() || null;
    const destinationPlant = lines[18]?.trim() || null;
    const nagareTime       = lines[20]?.trim() || null;
    const modelCode        = lines[21]?.trim() || null;
    const variant          = lines[24]?.trim() || null;

    return {
      binNumber,
      productCode,
      casePack,
      productName,
      supplyDate,
      invoiceNumber,
      totalSupplyQty,
      destinationCode,
      scheduleNumber,
      unloadLocation,
      totalBins,
      vendorName,
      destinationPlant,
      nagareTime,
      modelCode,
      variant,
    };
  } catch (err) {
    console.error('NHK Bin Parsing Error:', err);
    return null;
  }
}

function parseNhkPart(raw) {
  try {
    const trimmed = raw.trim();
    const tokens  = trimmed.split(/\s+/);
    if (tokens.length !== 6) return null;
    return {
      raw:             trimmed,
      destinationCode: tokens[0],
      lineNo:          tokens[1],
      productCode:     tokens[2].toUpperCase(),
      date:            tokens[3],
      grade:           tokens[4],
      serialNo:        tokens[5],
    };
  } catch (err) {
    return null;
  }
}

module.exports = { parseNhkBin, parseNhkPart, normalizeNhkCode };