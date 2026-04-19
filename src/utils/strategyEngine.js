// src/utils/strategyEngine.js
const { normalizeCode } = require('./qrParser');

function runStrategy(dispatch, parsed, type) {
  const fieldsToMatch = [
    'ref_product_code',
    'ref_case_pack',
    'ref_supply_date',
    'ref_schedule_sent_date',
    'ref_schedule_number',
  ];

  const map = {
    ref_product_code: 'productCode',
    ref_case_pack: 'casePack',
    ref_supply_date: 'supplyDate',
    ref_schedule_sent_date: 'scheduleSentDate',
    ref_schedule_number: 'scheduleNumber',
  };

  for (const dbField of fieldsToMatch) {
    const refVal = dispatch[dbField];
    if (refVal == null) continue;

    const parsedVal = parsed[map[dbField]];

    if (dbField === 'ref_product_code') {
      if (normalizeCode(refVal) !== normalizeCode(parsedVal)) {
        return { ok: false, message: 'Product Code mismatch' };
      }
    } 
    // IMPROVEMENT: For Pick-lists, casePack is optional. 
    // Only throw error if a case pack was found and it DOES NOT match.
    else if (dbField === 'ref_case_pack' && type === 'PICKLIST' && parsedVal === null) {
      continue; 
    }
    else if (dbField === 'ref_supply_date') {
      // Note: normalizeDate should be imported if used here, 
      // but since we use TEXT in DB now, we just compare strings.
      if (String(refVal) !== String(parsedVal)) {
        return { ok: false, message: 'Supply Date mismatch' };
      }
    } 
    else {
      if (String(refVal) !== String(parsedVal)) {
        const friendly = dbField.replace('ref_', '').replace('_', ' ');
        return { ok: false, message: `${friendly} mismatch` };
      }
    }
  }

  return { ok: true };
}

module.exports = {
  runStrategy,
};
