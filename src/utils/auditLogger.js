const db = require('../config/db');

/**
 * Simple helper to insert an audit row.
 * `data` must contain:
 *   dispatchId, type, code, product_code, result,
 *   operator_user_id, raw_qr, error_message (optional)
 */
async function logAudit(data) {
  const {
    dispatchId,
    type,
    code,
    product_code,
    result,
    operator_user_id,
    raw_qr,
    error_message = null,
  } = data;

  await db.query(
    `INSERT INTO audit_logs
      (dispatch_id, type, code, product_code, result,
       operator_user_id, raw_qr, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      dispatchId,
      type,
      code,
      product_code,
      result,
      operator_user_id,
      raw_qr,
      error_message,
    ]
  );
}

module.exports = { logAudit };
