const parser   = require('./parser');
const strategy = require('./strategy');
const routes   = require('./routes');

module.exports = {
  strategyCode: 'NITERA_1to1',
  displayName:  'Nitera',
  parser,
  strategy,
  routes,
};
