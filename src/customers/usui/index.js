const parser   = require('./parser');
const strategy = require('./strategy');
const routes   = require('./routes');

module.exports = {
  strategyCode: 'USUI_1toMany',
  displayName:  'USUI',
  parser,
  strategy,
  routes,
};
