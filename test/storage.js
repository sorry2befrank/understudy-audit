"use strict";

// A small in-memory stand-in for window.localStorage.
function memoryStorage() {
  const map = new Map();
  return {
    map,
    get length() { return map.size; },
    key: index => [...map.keys()][index] ?? null,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); }
  };
}

module.exports = { memoryStorage };
