// src/strategies/index.js
const nitera1to1 = require('./nitera_1to1');
const usui1toMany = require('./usui_1toMany');

const STRATEGY_REGISTRY = {
  'NITERA_1to1': nitera1to1,
  'USUI_1toMany': usui1toMany,
  // Future strategies will be added here:
  // 'SAMSUNG_X': require('./samsung_x'),
};

module.exports = {
  getStrategy: (code) => {
    const strategy = STRATEGY_REGISTRY[code];
    if (!strategy) {
      throw new Error(`Strategy code ${code} not found in registry.`);
    }
    return strategy;
  }
};
