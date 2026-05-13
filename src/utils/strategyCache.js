/**
 * strategyCache.js
 * Dedicated in-memory cache for customer-strategy mappings.
 * Single responsibility: Cache management only.
 */

const cache = new Map();

function get(customerId) {
  return cache.get(customerId);
}

function set(customerId, strategyCode) {
  cache.set(customerId, strategyCode);
}

function clear(customerId) {
  if (customerId) {
    cache.delete(customerId);
  } else {
    cache.clear();
  }
}

module.exports = { get, set, clear };