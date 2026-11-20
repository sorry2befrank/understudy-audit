"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Discovery = require("../discovery.js");
const { memoryStorage } = require("./storage.js");

const CONFIG = { serviceUrl: "https://research.example.com", accessToken: "test-access-code" };

function recordingFetcher(payload = { places: [] }) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => payload };
  };
  return { calls, fetcher };
}

test("roundCoordinate() keeps three decimals (about 110 m of latitude)", () => {
  assert.equal(Discovery.roundCoordinate(33.7489954), 33.749);
  assert.equal(Discovery.roundCoordinate(-84.3879824), -84.388);
  assert.equal(Discovery.roundCoordinate("40.12345"), 40.123);
  assert.throws(() => Discovery.roundCoordinate("abc"), /unavailable/);
  assert.throws(() => Discovery.roundCoordinate(Infinity), /unavailable/);
  assert.throws(() => Discovery.roundCoordinate(undefined), /unavailable/);
});

test("getApproximateLocation() asks for low accuracy and returns rounded coordinates", async () => {
  let options;
  const geolocation = {
    getCurrentPosition(success, _failure, opts) {
      options = opts;
      success({ coords: { latitude: 33.7489954, longitude: -84.3879824, accuracy: 15.6 } });
    }
  };
  const location = await Discovery.getApproximateLocation(geolocation);
  assert.deepEqual(location, { latitude: 33.749, longitude: -84.388, accuracyMeters: 16 });
  assert.equal(options.enableHighAccuracy, false);
});

test("getApproximateLocation() labels a denied permission so the app can show recovery steps", async () => {
  const geolocation = { getCurrentPosition(_success, failure) { failure({ code: 1 }); } };
  await assert.rejects(Discovery.getApproximateLocation(geolocation), error => error.code === "LOCATION_PERMISSION_DENIED");
  await assert.rejects(Discovery.getApproximateLocation(null), error => error.code === "LOCATION_UNAVAILABLE");
});

test("normalizeServiceUrl() requires HTTPS except on localhost", () => {
  assert.throws(() => Discovery.normalizeServiceUrl("http://research.example.com"), /must use HTTPS/);
  assert.throws(() => Discovery.normalizeServiceUrl("ftp://research.example.com"), /must use HTTPS/);
  assert.equal(Discovery.normalizeServiceUrl("https://research.example.com/api/?token=x#frag"), "https://research.example.com/api");
  assert.equal(Discovery.normalizeServiceUrl("http://localhost:8787/"), "http://localhost:8787");
  assert.equal(Discovery.normalizeServiceUrl("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
});

test("saveConfig() refuses an insecure service URL and stores nothing", () => {
  const storage = memoryStorage();
  assert.throws(() => Discovery.saveConfig({ serviceUrl: "http://research.example.com", accessToken: "x" }, storage), /HTTPS/);
  assert.equal(storage.getItem(Discovery.CONFIG_KEY), null);
});

test("searchBusinesses() sends only the query, rounded coordinates and a clamped radius", async () => {
  const { calls, fetcher } = recordingFetcher();
  await Discovery.searchBusinesses(
    { query: "  bakery  ", location: { latitude: 33.7489954, longitude: -84.3879824, accuracyMeters: 16 }, radiusMiles: 50 },
    { config: CONFIG, fetcher }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://research.example.com/v1/places");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["X-Understudy-Access"], "test-access-code");
  assert.deepEqual(calls[0].body, { mode: "search", query: "bakery", latitude: 33.749, longitude: -84.388, radiusMiles: 10 });
});

test("no request leaves the device without a connection or over plain HTTP", async () => {
  const { calls, fetcher } = recordingFetcher();
  const location = { latitude: 33.7, longitude: -84.3 };
  await assert.rejects(
    Discovery.searchBusinesses({ location }, { config: { ...CONFIG, accessToken: "" }, fetcher }),
    /Connect the discovery service/
  );
  await assert.rejects(
    Discovery.searchBusinesses({ location }, { config: { ...CONFIG, serviceUrl: "http://research.example.com" }, fetcher }),
    /must use HTTPS/
  );
  await assert.rejects(Discovery.searchBusinesses({ query: "x" }, { config: CONFIG, fetcher }), /Use your location/);
  assert.equal(calls.length, 0);
});

test("researchBusiness() rejects a non-web website and rounds the place coordinates", async () => {
  const { calls, fetcher } = recordingFetcher({});
  await assert.rejects(
    Discovery.researchBusiness({ id: "p1", name: "Demo", website: "javascript:alert(1)" }, { config: CONFIG, fetcher }),
    /valid public website/
  );
  assert.equal(calls.length, 0);

  await Discovery.researchBusiness(
    { id: "p1", name: "Demo", address: "1 Example St", latitude: 33.7489954, longitude: -84.3879824, website: "https://bakery.example/" },
    { config: CONFIG, fetcher }
  );
  assert.equal(calls[0].url, "https://research.example.com/v1/research");
  assert.equal(calls[0].body.latitude, 33.749);
  assert.equal(calls[0].body.longitude, -84.388);
  assert.equal(calls[0].body.website, "https://bakery.example/");
});

test("consent is stored on the device and can be withdrawn", () => {
  const storage = memoryStorage();
  assert.equal(Discovery.hasConsent(storage), false);
  Discovery.grantConsent(storage, new Date("2026-01-15T12:00:00Z"));
  assert.equal(Discovery.hasConsent(storage), true);
  Discovery.revokeConsent(storage);
  assert.equal(Discovery.hasConsent(storage), false);
});

test("auditFromResearch() keeps only evidence with a safe web source", () => {
  const audit = Discovery.auditFromResearch({
    business: { name: "Demo Cafe", website: "https://cafe.example/" },
    evidence: [
      { label: "Ordering", detail: "Has online ordering", sourceUrl: "https://cafe.example/order" },
      { label: "Bad", detail: "Unsafe link", sourceUrl: "javascript:alert(1)" },
      { label: "Missing", detail: "No link" }
    ]
  }, () => "fixed-id");
  assert.equal(audit.id, "fixed-id");
  assert.equal(audit.observed.length, 1);
  assert.equal(audit.observed[0].sourceUrl, "https://cafe.example/order");
});

test("no research service URL ships with the public build", () => {
  assert.equal(Discovery.DEFAULT_SERVICE_URL, "");
  const config = Discovery.loadConfig(memoryStorage());
  assert.equal(config.serviceUrl, "");
  assert.equal(config.accessToken, "");
});
