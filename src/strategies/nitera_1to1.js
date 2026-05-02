// src/strategies/nitera_1to1.js
const { normalizeCode } = require('../utils/qrParser');

module.exports = {
  name: 'Nitera 1:1 Validation',
  
  // This is called during the BIN scan
  validateBin: (dispatch, parsed) => {
    const fieldsToMatch = [
      { db: 'ref_product_code', parsed: 'productCode', label: 'Product Code' },
      { db: 'ref_case_pack', parsed: 'casePack', label: 'Case Pack' },
      { db: 'ref_supply_date', parsed: 'supplyDate', label: 'Supply Date' },
      { db: 'ref_schedule_sent_date', parsed: 'scheduleSentDate', label: 'Schedule Sent Date' },
      { db: 'ref_schedule_number', parsed: 'scheduleNumber', label: 'Schedule Number' },
    ];

    for (const field of fieldsToMatch) {
      const refVal = dispatch[field.db];
      if (refVal == null) continue; // Skip if first bin hasn't set reference yet

      const parsedVal = parsed[field.parsed];
      
      if (field.db === 'ref_product_code') {
        if (normalizeCode(refVal) !== normalizeCode(parsedVal)) {
          return { ok: false, message: `Product Code mismatch: ${field.label}` };
        }
      } else {
        if (String(refVal) !== String(parsedVal)) {
          return { ok: false, message: `${field.label} mismatch` };
        }
      }
    }
    return { ok: true };
  },

  // This is called during the PICKLIST scan
  validatePick: (dispatch, parsed) => {
    if (normalizeCode(dispatch.ref_product_code) !== normalizeCode(parsed.productCode)) {
      return { ok: false, message: 'Pick-list Product Code mismatch' };
    }
    return { ok: true };
  }
};
