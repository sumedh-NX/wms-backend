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
// Different label types have different field lengths (e.g. product name length varies),
// so we use sequential token extraction anchored on the seqStr (X/Y) pattern rather
// than hardcoded byte positions.
//
// Token structure (blank lines collapse to whitespace):
//   [binNumber] ... [productCode] ... [casePack] ... [productName tokens] ...
//   [binRepeat?] [supplyDate] [invoiceNumber] [totalSupplyQty] [destinationCode]
//   [scheduleNumber] [unloadLocation] [seqStr X/Y] [vendorName tokens]
//   [destinationPlant] [nagareTime] [modelCode] [variant]
//
// The bin number repeat may appear before or after supplyDate depending on label format;
// we remove it from the middle segment before counting backwards to the fixed 6-token block.
function parseNhkBinFlat(raw) {
  // bin number: always the first 13 digits
  const binNumber = raw.slice(0, 13);
  if (!/^\d{13}$/.test(binNumber)) return null;

  // product code: first non-space token after bin number
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

  // seqStr is X/Y (bin index / total bins). Use negative lookahead/lookbehind to
  // avoid matching slashes inside date strings like "22/05/26" or "23/05/2026".
  const seqM = raw.match(/(?<![\/\d])(\d+)\/(\d+)(?![\/\d])/);
  if (!seqM) return null;
  const totalBins = parseInt(seqM[2]);

  // Middle segment: between end-of-casePack and start-of-seqStr.
  // Remove the bin number repeat (same 13 digits) so it doesn't displace the count.
  const cpEnd  = 13 + pcm[0].length + cpm[0].length;
  const midSeg = raw.slice(cpEnd, seqM.index).replace(binNumber, ' ');
  const midTokens = midSeg.trim().split(/\s+/).filter(t => t !== '-' && t.length > 0);

  // The last 6 tokens before seqStr are always (in order):
  //   supplyDate, invoiceNumber, totalSupplyQty, destinationCode, scheduleNumber, unloadLocation
  // Everything before them reconstructs productName.
  let productName = null, supplyDate = null, invoiceNumber = null;
  let totalSupplyQty = null, destinationCode = null, scheduleNumber = null, unloadLocation = null;

  if (midTokens.length >= 6) {
    const pi = midTokens.length - 6;
    productName     = midTokens.slice(0, pi).join(' ') || null;
    supplyDate      = midTokens[pi]                    || null;
    invoiceNumber   = midTokens[pi + 1]                || null;
    totalSupplyQty  = parseInt(midTokens[pi + 2])      || null;
    destinationCode = midTokens[pi + 3]                || null;
    scheduleNumber  = midTokens[pi + 4]                || null;
    unloadLocation  = midTokens[pi + 5]                || null;
  }

  // Tail segment: after seqStr.
  // Use nagareTime as a pattern anchor because several fields are multi-token
  // (e.g. "MSIL - GVP", "23/05/2026 12:30 PM") and label formats vary.
  //   new format: DD/MM/YYYY HH:MM AM/PM
  //   old format: YYMMDD-YYMMDD
  const tailSeg = raw.slice(seqM.index + seqM[0].length);
  const nagareRx = /(\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M|\d{6}-\d{6})/;
  const nagareM  = nagareRx.exec(tailSeg);

  let vendorName = null, destinationPlant = null, nagareTime = null;
  let modelCode = null, variant = null;

  if (nagareM) {
    nagareTime = nagareM[1];

    // After nagareTime: skip dash separators; first two non-dash tokens are modelCode, variant.
    const afterNagare  = tailSeg.slice(nagareM.index + nagareM[0].length);
    const afterTokens  = afterNagare.trim().split(/\s+/).filter(t => t !== '-' && t.length > 0);
    modelCode = afterTokens[0] || null;
    variant   = afterTokens[1] || null;

    // Before nagareTime: trim trailing dash separator, then split at the double-dash gap
    // that separates vendorName from destinationPlant (lines[16-17] = two blank/dash lines).
    const beforeNagare        = tailSeg.slice(0, nagareM.index).replace(/\s+-\s*$/, '').trim();
    const doubleDashSegments  = beforeNagare.split(/\s+-\s+-\s+/);
    if (doubleDashSegments.length >= 2) {
      vendorName       = doubleDashSegments[0].trim() || null;
      destinationPlant = doubleDashSegments[doubleDashSegments.length - 1].trim() || null;
    } else {
      // Old format: no explicit dashes; destinationPlant is the last space-separated token
      const seg = beforeNagare.split(/\s+/).filter(t => t !== '-' && t.length > 0);
      destinationPlant = seg[seg.length - 1] || null;
      vendorName       = seg.slice(0, -1).join(' ') || null;
    }
  } else {
    // Fallback: filter out dash separators, count from the end
    const tailTokens = tailSeg.trim().split(/\s+/).filter(t => t !== '-' && t.length > 0);
    if (tailTokens.length >= 4) {
      const ti = tailTokens.length - 4;
      vendorName       = tailTokens.slice(0, ti).join(' ') || null;
      destinationPlant = tailTokens[ti]     || null;
      nagareTime       = tailTokens[ti + 1] || null;
      modelCode        = tailTokens[ti + 2] || null;
      variant          = tailTokens[ti + 3] || null;
    }
  }

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