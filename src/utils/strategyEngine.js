const db = require('../config/db');
const { getStrategy } = require('../strategies');

async function runStrategy(dispatch, parsed, type) {
  try {
    // 1. Find the strategy code assigned to this customer in the DB
    const strategyQuery = `
      SELECT vs.code 
      FROM validation_strategies vs
      JOIN customer_strategies cs ON vs.id = cs.strategy_id
      WHERE cs.customer_id = $1
    `;
    const { rows } = await db.query(strategyQuery, [dispatch.customer_id]);
    
    if (rows.length === 0) {
    return { ok: false, message: 'No validation strategy assigned to this customer. Please contact admin.' };
    }


    const strategyCode = rows[0].code; 
    const strategyLogic = getStrategy(strategyCode);

    // 2. Execute the specific logic from the isolated file
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

module.exports = { runStrategy };
