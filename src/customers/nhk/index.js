const parser   = require('./parser');
const strategy = require('./strategy');
const routes   = require('./routes');

module.exports = {
  strategyCode: 'NHKS_1toMany',
  displayName:  'NHK SPRINGS',
  parser,
  strategy,
  routes,
};