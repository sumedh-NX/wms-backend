/**
 * Customer Plugin Registry
 * To add a new customer: create src/customers/<name>/index.js and add one entry here.
 * To remove a customer: delete the folder and remove the entry here.
 */
const nitera = require('./nitera');
const usui   = require('./usui');
const nhk    = require('./nhk');

const CUSTOMER_REGISTRY = [nitera, usui, nhk];

module.exports = CUSTOMER_REGISTRY;