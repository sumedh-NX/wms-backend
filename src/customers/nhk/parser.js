function normalizeNhkCode(code) {
  if (!code) return '';
  return code.toUpperCase().trim().replace(/-/g, '');
}

function parseNhkBin(raw) {
  try {
    const lines = raw.split(/\r?\n/);

    const binNumber = lines[0]?.trim();
    if (!binNumber || !/^\d{13}$/.test(binNumber)) return null;

    const productCode = lines[2]?.trim();
    if (!productCode) return null;

    const casePack = parseInt(lines[3]?.trim());
    if (isNaN(casePack)) return null;

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