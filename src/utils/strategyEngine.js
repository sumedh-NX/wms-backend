const db = require('../config/db');
const { getStrategy } = require('../strategies');

// In-memory cache for performance: { "customerId": "STRATEGY_CODE" }
const strategyCache = new Map();

async function runStrategy(dispatch, parsed, type) {
  try {
    const customerId = dispatch.customer_id;
    let strategyCode = strategyCache.get(customerId);

    // 1. If not in cache, fetch from DB
    if (!strategyCode) {
      const strategyQuery = `
        SELECT vs.code 
        FROM validation_strategies vs
        JOIN customer_strategies cs ON vs.id = cs.strategy_id
        WHERE cs.customer_id = $1
      `;
      const { rows } = await db.query(strategyQuery, [customerId]);
      
      if (rows.length > 0) {
        strategyCode = rows[0].code;
        strategyCache.set(customerId, strategyCode);
      }
    }

    // 2. STRICT MODE: If no strategy is assigned, BLOCK the scan
    if (!strategyCode) {
      return { 
        ok: false, 
        message: 'No validation strategy assigned to this customer. Please contact admin.' 
      };
    }

    // 3. Load logic from Registry
    const strategyLogic = getStrategy(strategyCode);

    // 4. Execute Pure Logic
    if (type === 'BIN_LABEL') {
      return strategyLogic.validateBin(dispatch, parsed);
    } 
    if (type === 'PICKLIST') {
      return strategyLogic.validatePick(dispatch, parsed);
    }

    return { ok: false, message: 'Unknown scan type' };
  } catch (err) {
    console.error('Strategy Engine Error:', err);
    return { ok: false, message: 'System error during validation' };
  }
}

// Helper to clear cache when admin changes assignment
function clearStrategyCache(customerId) {
  if (customerId) {
    strategyCache.delete(customerId);
  } else {
    strategyCache.clear();
  }
}

module.exports = { runStrategy, clearStrategyCache };
