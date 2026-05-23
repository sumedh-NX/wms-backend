const CUSTOMER_REGISTRY = require('../customers/registry');

const STRATEGY_MAP = {};
for (const customer of CUSTOMER_REGISTRY) {
  STRATEGY_MAP[customer.strategyCode] = customer.strategy;
}

module.exports = {
  getStrategy: (code) => {
    const strategy = STRATEGY_MAP[code];
    if (!strategy) {
      throw new Error(`Strategy code "${code}" not found in registry.`);
    }
    return strategy;
  },
};
