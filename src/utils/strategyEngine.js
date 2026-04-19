// src/utils/strategyEngine.js - v2 clean
const { normalizeCode } = require('./qrParser');

function runStrategy(dispatch, parsed, type) {
  // For PICKLIST: only validate product code
  if (type === 'PICKLIST') {
    if (normalizeCode(dispatch.ref_product_code) !== normalizeCode(parsed.productCode)) {
      return { ok: false, message: 'Product Code mismatch' };
    }
    return { ok: true };
  }

  // For BIN_LABEL: validate all fields
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
    } else {
      if (String(refVal) !== String(parsedVal)) {
        const friendly = dbField.replace('ref_', '').replace(/_/g, ' ');
        return { ok: false, message: `${friendly} mismatch` };
      }
    }
  }
  return { ok: true };
}

module.exports = { runStrategy };