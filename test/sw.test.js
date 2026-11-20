"use strict";

// Runs sw.js in a sandbox with fake browser APIs and checks which navigations reach the cache.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCOPE = "https://demo.example/understudy-audit/";

function loadWorker({ online = true } = {}) {
  const listeners = {};
  const puts = [];
  const cached = { ok: true, label: "cached app shell", clone() { return this; } };
  const cache = { put: async (key, value) => { puts.push(key); }, addAll: async () => {} };
  const context = {
    URL,
    self: {
      location: new URL("sw.js", SCOPE),
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} }
    },
    caches: {
      open: async () => cache,
      match: async () => cached,
      keys: async () => [],
      delete: async () => true
    },
    fetch: async request => {
      if (!online) throw new TypeError("offline");
      return { ok: true, label: `network ${request.url}`, clone() { return this; } };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8"), context);
  async function navigate(url) {
    let responsePromise;
    listeners.fetch({ request: { url, method: "GET", mode: "navigate" }, respondWith: p => { responsePromise = p; } });
    return responsePromise;
  }
  return { navigate, puts };
}

test("a navigation to audit-app.html refreshes the cached app shell", async () => {
  const worker = loadWorker();
  await worker.navigate(SCOPE + "audit-app.html?utm=x");
  assert.deepEqual(worker.puts, [SCOPE + "audit-app.html"]);
});

test("other navigations are never written into the app-shell cache", async () => {
  const worker = loadWorker();
  for (const page of ["", "index.html", "missing-page.html"]) {
    const response = await worker.navigate(SCOPE + page);
    assert.equal(response.label, `network ${SCOPE + page}`);
  }
  assert.deepEqual(worker.puts, []);
});

test("offline navigations fall back to the cached app shell", async () => {
  const worker = loadWorker({ online: false });
  assert.equal((await worker.navigate(SCOPE + "audit-app.html")).label, "cached app shell");
  assert.equal((await worker.navigate(SCOPE)).label, "cached app shell");
  assert.deepEqual(worker.puts, []);
});
