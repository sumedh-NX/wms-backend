// src/utils/strategyEngine.js
const { normalizeCode, normalizeDate } = require('./qrParser');

/**
 * Validates a scan against the dispatch reference.
 */
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
    if (refVal == null) continue; // First bin: skip validation

    const parsedVal = parsed[map[dbField]];

    // 1. Product Code Normalization (matches 18213M... with 18213-...)
    if (dbField === 'ref_product_code') {
      if (normalizeCode(refVal) !== normalizeCode(parsedVal)) {
        return { ok: false, message: 'Product Code mismatch' };
      }
    } 
    // 2. Date Normalization (matches "2026-03-26" with "26/03/2026 07:30 PM")
    else if (dbField === 'ref_supply_date') {
      if (normalizeDate(refVal) !== normalizeDate(parsedVal)) {
        return { ok: false, message: 'Supply Date mismatch' };
      }
    } 
    // 3. Standard string/number comparison for all other fields
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
