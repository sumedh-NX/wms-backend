/**
 * Executes the validation strategy stored in the DB.
 * `dispatch` – row from dispatches table (may have reference fields)
 * `parsed`   – object returned by the QR parser (bin or pick)
 * `type`     – 'BIN_LABEL' or 'PICKLIST'
 *
 * Returns: { ok: true } on success or { ok: false, message: '…' }
 */
function runStrategy(dispatch, parsed, type) {
  // For now we only have one built‑in strategy: matchFields defined in config
  // The strategy row is obtained by joining customer_strategies in the route,
  // but to keep the code simple we embed the config directly.
  // You can later fetch the strategy JSON from the DB and read its fields.

  // --------- BASIC MATCHES ----------
  const fieldsToMatch = [
    'ref_product_code',
    'ref_case_pack',
    'ref_supply_date',
    'ref_schedule_sent_date',
    'ref_schedule_number',
  ];

  for (const field of fieldsToMatch) {
    const refVal = dispatch[field];
    // If the reference is null (i.e., first bin) we skip the check.
    if (refVal === null || refVal === undefined) continue;

    // Map DB column name to parser property name
    const map = {
      ref_product_code: 'productCode',
      ref_case_pack: 'casePack',
      ref_supply_date: 'supplyDate',
      ref_schedule_sent_date: 'scheduleSentDate',
      ref_schedule_number: 'scheduleNumber',
    };
    const parsedVal = parsed[map[field]];
    if (String(refVal) !== String(parsedVal)) {
      return {
        ok: false,
        message: `${field.replace('ref_', '').replace('_', ' ')} mismatch`,
      };
    }
  }

  // --------- OPTIONAL CUSTOM JS ----------
  // The custom script (if any) is stored in dispatch.strategy_custom_js.
  // In the real code we would fetch it, but for MVP we assume none.
  // If you add a custom script, call the sandbox here:
  // const result = runCustomJs(dispatch.strategy_custom_js, {dispatch, parsed, type});
  // if (!result.ok) return result;

  return { ok: true };
}

module.exports = { runStrategy };
