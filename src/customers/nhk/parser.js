function normalizeNhkCode(code) {
  if (!code) return '';
  return code.toUpperCase().trim().replace(/-/g, '');
}

function parseNhkBin(raw) {
  try {
    const hasNewlines = /[\r\n]/.test(raw);
    return hasNewlines ? parseNhkBinLines(raw) : parseNhkBinFlat(raw);
  } catch (err) {
    console.error('NHK Bin Parsing Error:', err);
    return null;
  }
}

// Normal path: scanner sends actual newlines
function parseNhkBinLines(raw) {
  const lines = raw.split(/\r\n|\r|\n/);

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

  const seqStr   = lines[14]?.trim() || '';
  const seqMatch = seqStr.match(/^(\d+)\/(\d+)$/);
  const totalBins = seqMatch ? parseInt(seqMatch[2]) : null;

  const vendorName       = lines[15]?.trim() || null;
  const destinationPlant = lines[18]?.trim() || null;
  const nagareTime       = lines[20]?.trim() || null;
  const modelCode        = lines[21]?.trim() || null;
  const variant          = lines[24]?.trim() || null;

  return {
    binNumber, productCode, casePack, productName, supplyDate,
    invoiceNumber, totalSupplyQty, destinationCode, scheduleNumber,
    unloadLocation, totalBins, vendorName, destinationPlant,
    nagareTime, modelCode, variant,
  };
}

// Flat path: scanner converts every \n → space, so the entire QR arrives as one string.
// The label uses fixed-width columns; positions below are verified from the 227-char format.
//
// Layout (0-indexed):
//  0-12   bin number (13 digits)
//  13-35  spaces  (line0 pad + blank line1 + separators)
//  36-46  product code (11 chars, padded to match line width)
//  47-51  spaces
//  52-54  case pack
//  55-60  spaces
//  61-76  product name
//  77     space
//  78-90  bin number repeat
//  91     space
//  92-100 supply date
//  101-103 spaces (trailing + 2 empty lines)
//  104-113 invoice number
//  114    space
//  115-117 total supply qty
//  118    space
//  119-122 destination code
//  123    space
//  124-138 schedule number
//  139    space
//  140-144 unload location
//  145    space
//  146-148 bin sequence
//  149    space
//  150-170 vendor name
//  171-175 spaces / dashes
//  176-185 destination plant
//  186-188 spaces / dash
//  189-207 nagare time
//  208    space
//  209-212 model code
//  213-217 spaces / dashes
//  218-220 variant
function parseNhkBinFlat(raw) {
  // bin number: always the first 13 digits
  const binNumber = raw.slice(0, 13);
  if (!/^\d{13}$/.test(binNumber)) return null;

  // product code: first non-space token after bin number (separated by ~23 spaces)
  const afterBin = raw.slice(13);
  const pcm = afterBin.match(/^\s+(\S+)/);
  if (!pcm) return null;
  const productCode = pcm[1];

  // case pack: first integer token after product code
  const afterPc = afterBin.slice(pcm[0].length);
  const cpm = afterPc.match(/^\s+(\d+)/);
  if (!cpm) return null;
  const casePack = parseInt(cpm[1]);
  if (isNaN(casePack)) return null;

  // remaining fields at fixed positions verified from the 227-char label format
  const productName     = raw.slice(61, 77).trim()   || null;
  const supplyDate      = raw.slice(92, 101).trim()  || null;
  const invoiceNumber   = raw.slice(104, 114).trim() || null;
  const totalSupplyQty  = parseInt(raw.slice(115, 118).trim()) || null;
  const destinationCode = raw.slice(119, 123).trim() || null;
  const scheduleNumber  = raw.slice(124, 139).trim() || null;
  const unloadLocation  = raw.slice(140, 145).trim() || null;

  const seqStr   = raw.slice(146, 149).trim() || '';
  const seqMatch = seqStr.match(/^(\d+)\/(\d+)$/);
  const totalBins = seqMatch ? parseInt(seqMatch[2]) : null;

  const vendorName       = raw.slice(150, 171).trim() || null;
  const destinationPlant = raw.slice(176, 186).trim() || null;
  const nagareTime       = raw.slice(189, 208).trim() || null;
  const modelCode        = raw.slice(209, 213).trim() || null;
  const variant          = raw.slice(218, 221).trim() || null;

  return {
    binNumber, productCode, casePack, productName, supplyDate,
    invoiceNumber, totalSupplyQty, destinationCode, scheduleNumber,
    unloadLocation, totalBins, vendorName, destinationPlant,
    nagareTime, modelCode, variant,
  };
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