// Example for Bin QR
export function parseBinQR(raw) {
  // 1️⃣ extract bin number (first 13 digits)
  const binNumberMatch = raw.match(/^(\d{13})/);
  if (!binNumberMatch) throw new Error('Bin number not found');
  const binNumber = binNumberMatch[1];

  // 2️⃣ product code (next 10 alphanum after spaces)
  const productCodeMatch = raw.match(/\s+([A-Z0-9]{10})\s+/);
  if (!productCodeMatch) throw new Error('Product code not found');
  const productCode = productCodeMatch[1];

  // 3️⃣ case pack (3 digits after product code)
  const casePackMatch = raw.match(/\s+(\d{3})\s+/);
  const casePack = casePackMatch ? parseInt(casePackMatch[1], 10) : null;

  // 4️⃣ schedule sent date (dd/MM/yy)
  const scheduleDateMatch = raw.match(/(\d{2}\/\d{2}\/\d{2})/);
  const scheduleSentDate = scheduleDateMatch ? scheduleDateMatch[1] : null;

  // 5️⃣ invoice (8 digits right after schedule date)
  const invoiceMatch = raw.match(/(\d{2}\/\d{2}\/\d{2})(\d{8})/);
  const invoiceNumber = invoiceMatch ? invoiceMatch[2] : null;

  // 6️⃣ supply quantity (3 digits after invoice)
  const supplyQtyMatch = raw.match(/(\d{8})(\d{3})/);
  const supplyQuantity = supplyQtyMatch ? parseInt(supplyQtyMatch[2], 10) : null;

  // 7️⃣ vendor code (e.g., N285)
  const vendorMatch = raw.match(/N\d{3}/);
  const vendorCode = vendorMatch ? vendorMatch[0] : null;

  // 8️⃣ schedule number (pattern looks like 28P650741683EP4)
  const scheduleNumMatch = raw.match(/(\d{2}P\d{9}EP\d)/);
  const scheduleNumber = scheduleNumMatch ? scheduleNumMatch[1] : null;

  // 9️⃣ supply date (dd/MM/yyyy HH:mm)
  const supplyDateMatch = raw.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/);
  const supplyDate = supplyDateMatch ? supplyDateMatch[1] : null;

  // 1️⃣0️⃣ unload location (e.g., PE-10)
  const unloadMatch = raw.match(/PE-\d+/);
  const unloadLoc = unloadMatch ? unloadMatch[0] : null;

  // 1️⃣1️⃣ product name (text before the second occurrence of bin number)
  const namePart = raw.split(binNumber)[0];
  const productName = namePart.trim();

  return {
    binNumber,
    productCode,
    casePack,
    scheduleSentDate,
    invoiceNumber,
    supplyQuantity,
    vendorCode,
    scheduleNumber,
    supplyDate,
    unloadLoc,
    productName,
    raw,
  };
}

// Picklist QR parser (simplified)
export function parsePickQR(raw) {
  const pickCodeMatch = raw.match(/^([A-Z0-9]+)_/);
  const pickCode = pickCodeMatch ? pickCodeMatch[1] : null;

  const productCodeMatch = raw.match(/\s+([A-Z0-9]{10})\s+/);
  const productCode = productCodeMatch ? productCodeMatch[1] : null;

  const casePackMatch = raw.match(/(\d{3})\s*$/); // often at the end
  const casePack = casePackMatch ? parseInt(casePackMatch[1], 10) : null;

  return {
    pickCode,
    productCode,
    casePack,
    raw,
  };
}
