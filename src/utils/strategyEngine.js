/**
 * strategyEngine.js
 * Pure execution logic. No caching, no DB management.
 */

const db = require('../config/db');
const { getStrategy } = require('../strategies');
const cache = require('./strategyCache');

/**
 * Resolves the strategy code for a customer.
 * Uses cache-first lookup, falls back to DB.
 */
async function resolveStrategyCode(customerId) {
  let strategyCode = cache.get(customerId);
  
  if (!strategyCode) {
    const { rows } = await db.query(
      `SELECT vs.code FROM validation_strategies vs
       JOIN customer_strategies cs ON vs.id = cs.strategy_id
       WHERE cs.customer_id = $1`,
      [customerId]
    );
    
    if (rows.length > 0) {
      strategyCode = rows[0].code;
      cache.set(customerId, strategyCode);
    }
  }
  
  return strategyCode;
}

/**
 * Generic strategy executor.
 * Used by Nitera workflow (BIN_LABEL, PICKLIST validation).
 */
async function runStrategy(dispatch, parsed, type) {
  try {
    const strategyCode = await resolveStrategyCode(dispatch.customer_id);
    
    if (!strategyCode) {
      return { 
        ok: false, 
        message: 'No validation strategy assigned to this customer. Please contact admin.' 
      };
    }

    const strategyLogic = getStrategy(strategyCode);

    if (type === 'BIN_LABEL') return strategyLogic.validateBin(dispatch, parsed);
    if (type === 'PICKLIST') return strategyLogic.validatePick(dispatch, parsed);

    return { ok: false, message: 'Unknown scan type' };
  } catch (err) {
    console.error('Strategy Engine Error:', err);
    return { ok: false, message: 'System error during validation' };
  }
}

module.exports = { 
  runStrategy, 
  resolveStrategyCode,
  clearStrategyCache: cache.clear  // Re-export for admin convenience
};