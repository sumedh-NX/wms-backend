// Lazy-initialised map — avoids the circular dep:
//   registry -> nitera/index -> nitera/routes -> strategyEngine -> strategies/index -> registry
// By deferring require('../customers/registry') to first call, all modules are fully
// loaded before the map is built.
let STRATEGY_MAP = null;

function getStrategyMap() {
  if (!STRATEGY_MAP) {
    const CUSTOMER_REGISTRY = require('../customers/registry');
    STRATEGY_MAP = {};
    for (const customer of CUSTOMER_REGISTRY) {
      STRATEGY_MAP[customer.strategyCode] = customer.strategy;
    }
  }
  return STRATEGY_MAP;
}

module.exports = {
  getStrategy: (code) => {
    const strategy = getStrategyMap()[code];
    if (!strategy) {
      throw new Error(`Strategy code "${code}" not found in registry.`);
    }
    return strategy;
  },
};