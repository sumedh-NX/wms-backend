const { normalizeCode } = require('./qrParser');

/**
 * Validates a scan against the dispatch reference.
 * Uses normalizeCode to ensure product matches even if formatting differs.
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
    if (refVal == null) continue; // first bin: skip validation

    const parsedVal = parsed[map[dbField]];

    // SPECIAL CASE: Product Code comparison uses Normalization
    if (dbField === 'ref_product_code') {
      if (normalizeCode(refVal) !== normalizeCode(parsedVal)) {
        return { ok: false, message: 'Product Code mismatch' };
      }
    } else {
      // Standard string/number comparison for other fields
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
