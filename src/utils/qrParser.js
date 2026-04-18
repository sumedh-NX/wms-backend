// src/utils/qrParser.js
// --------------------------------------------------------------
// QR‑parser for the **Bin** label (variable‑length fields)
// --------------------------------------------------------------

function parseBinQR(raw) {
  // 1️⃣ Bin number – first 13 digits
  const binMatch = raw.match(/^(\d{13})/);
  if (!binMatch) throw new Error('Invalid QR: Bin number must be 13 digits');
  const binNumber = binMatch[1];

  // 2️⃣ Product code – after spaces, up to next space before case pack
  const prodMatch = raw.match(/^\d{13}\s+([A-Z0-9]{4,12})\s+/i);
  if (!prodMatch) throw new Error('Product code not found');
  const productCode = prodMatch[1];

  // 3️⃣ Case pack – 2‑4 digits after product code
  const caseMatch = raw.match(new RegExp(`${productCode}\\s+(\\d{2,4})\\s+`));
  if (!caseMatch) throw new Error('Case pack not found');
  const casePack = parseInt(caseMatch[1], 10);

  // 4️⃣ First date (schedule sent date) – dd/MM/yy or dd/MM/yyyy
  const scheduleMatch = raw.match(/(\d{2}\/\d{2}\/\d{2,4})/);
  const scheduleSentDate = scheduleMatch ? scheduleMatch[1] : null;

  // 5️⃣ Invoice number – 8 digits after schedule date
  const invoiceMatch = raw.match(new RegExp(`${scheduleSentDate}\\s*(\\d{8})`));
  const invoiceNumber = invoiceMatch ? invoiceMatch[1] : null;

  // 6️⃣ Supply quantity – 2‑5 digits after invoice
  const supplyQtyMatch = raw.match(new RegExp(`${invoiceNumber}\\s*(\\d{2,5})`));
  const supplyQuantity = supplyQtyMatch ? parseInt(supplyQtyMatch[1], 10) : null;

  // 7️⃣ Vendor code – N + 3 digits (e.g., N285)
  const vendorMatch = raw.match(/N\d{3}/);
  const vendorCode = vendorMatch ? vendorMatch[0] : null;

  // 8️⃣ Schedule number – string that contains “EP” (e.g., 28P650741683EP4)
  const scheduleNumMatch = raw.match(/(\S+EP\d+)/);
  const scheduleNumber = scheduleNumMatch ? scheduleNumMatch[1] : null;

  // 9️⃣ Supply date – full datetime (dd/MM/yyyy HH:mm) optionally with AM/PM
  const supplyDateMatch = raw.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})(\s*[AP]M)?/);
  const supplyDate = supplyDateMatch ? supplyDateMatch[0].trim() : null;

  // 🔟 Unload location – PE‑... (e.g., PE‑10)
  const unloadMatch = raw.match(/PE-\w+/);
  const unloadLoc = unloadMatch ? unloadMatch[0] : null;

  // 📦 Product name – everything between the case pack and the first date
  const afterCasePack = raw.split(caseMatch[1])[1] || '';
  const productName = scheduleSentDate
    ? afterCasePack.split(scheduleSentDate)[0].trim()
    : afterCasePack.trim();

  return {
    binNumber,
    productCode,
    casePack,
    productName,
    scheduleSentDate,
    invoiceNumber,
    supplyQuantity,
    vendorCode,
    scheduleNumber,
    supplyDate,
    unloadLoc,
    raw,
  };
}

// --------------------------------------------------------------
// QR‑parser for the **Pick‑list** label (simpler)
// --------------------------------------------------------------

function parsePickQR(raw) {
  const pickMatch = raw.match(/^([^_]+)_/);
  if (!pickMatch) throw new Error('Pick code not found');
  const pickCode = pickMatch[1];

  const productMatch = raw.match(/\s+([A-Z0-9]{4,12})\s+/i);
  if (!productMatch) throw new Error('Product code not found in pick');
  const productCode = productMatch[1];

  const caseMatch = raw.match(/(\d{2,4})\s*$/);
  const casePack = caseMatch ? parseInt(caseMatch[1], 10) : null;

  return {
    pickCode,
    productCode,
    casePack,
    raw,
  };
}

// --------------------------------------------------------------
// Export for CommonJS (require) usage
// --------------------------------------------------------------
module.exports = {
  parseBinQR,
  parsePickQR,
};
