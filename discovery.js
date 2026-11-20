(function attachUnderstudyDiscovery(global) {
  "use strict";

  const CONFIG_KEY = "understudy_discovery_config_v1";
  const CONSENT_KEY = "understudy_discovery_consent_v1";
  const DEFAULT_TIMEOUT_MS = 25000;
  // No default research service ships with the public build: each device enters
  // its own service URL and access code, which stay in that device's storage.
  const DEFAULT_SERVICE_URL = "";

  function parseJson(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function normalizeServiceUrl(value) {
    const raw = String(value || "").trim().replace(/\/+$/, "");
    if (!raw) return "";
    const url = new URL(raw);
    const local = new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
      throw new Error("The discovery service must use HTTPS.");
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.href.replace(/\/$/, "");
  }

  function loadConfig(storage = global.localStorage) {
    const saved = parseJson(storage?.getItem(CONFIG_KEY), {});
    return {
      serviceUrl: String(saved?.serviceUrl || DEFAULT_SERVICE_URL),
      accessToken: String(saved?.accessToken || "")
    };
  }

  function saveConfig(config, storage = global.localStorage) {
    const value = {
      serviceUrl: normalizeServiceUrl(config?.serviceUrl),
      accessToken: String(config?.accessToken || "").trim()
    };
    storage?.setItem(CONFIG_KEY, JSON.stringify(value));
    return value;
  }

  function clearConfig(storage = global.localStorage) {
    storage?.removeItem(CONFIG_KEY);
  }

  function hasConsent(storage = global.localStorage) {
    const value = parseJson(storage?.getItem(CONSENT_KEY), null);
    return Boolean(value?.grantedAt);
  }

  function grantConsent(storage = global.localStorage, now = new Date()) {
    const value = { grantedAt: now.toISOString(), version: 1 };
    storage?.setItem(CONSENT_KEY, JSON.stringify(value));
    return value;
  }

  function revokeConsent(storage = global.localStorage) {
    storage?.removeItem(CONSENT_KEY);
  }

  function roundCoordinate(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error("Location is unavailable.");
    return Math.round(number * 1000) / 1000;
  }

  function getApproximateLocation(geolocation = global.navigator?.geolocation) {
    if (!geolocation?.getCurrentPosition) {
      const error = new Error("Location is not available in this browser.");
      error.code = "LOCATION_UNAVAILABLE";
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      geolocation.getCurrentPosition(
        position => resolve({
          latitude: roundCoordinate(position.coords.latitude),
          longitude: roundCoordinate(position.coords.longitude),
          accuracyMeters: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy)
            : null
        }),
        error => {
          const messages = {
            1: "Location permission was denied. Allow location for this site and try again.",
            2: "Your location could not be determined.",
            3: "Location took too long. Try again outdoors or with Wi-Fi enabled."
          };
          const locationError = new Error(messages[error?.code] || "Your location could not be determined.");
          locationError.code = error?.code === 1 ? "LOCATION_PERMISSION_DENIED" : "LOCATION_UNAVAILABLE";
          reject(locationError);
        },
        { enableHighAccuracy: false, maximumAge: 300000, timeout: 12000 }
      );
    });
  }

  function clampRadiusMiles(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 1;
    return Math.min(10, Math.max(0.25, number));
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return new Set(["http:", "https:"]).has(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  async function request(path, body, options = {}) {
    const config = options.config || loadConfig(options.storage);
    const serviceUrl = normalizeServiceUrl(config.serviceUrl);
    const accessToken = String(config.accessToken || "").trim();
    if (!serviceUrl || !accessToken) {
      throw new Error("Connect the discovery service before searching.");
    }

    const fetcher = options.fetcher || global.fetch;
    if (typeof fetcher !== "function") throw new Error("Internet requests are unavailable.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetcher(`${serviceUrl}${path}`, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-Understudy-Access": accessToken
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Discovery request failed (${response.status}).`);
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Discovery took too long. Try again.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function searchBusinesses({ query = "", location, radiusMiles = 1 }, options) {
    if (!location) return Promise.reject(new Error("Use your location before searching."));
    const cleanQuery = String(query).trim().slice(0, 120);
    return request("/v1/places", {
      mode: cleanQuery ? "search" : "nearby",
      query: cleanQuery,
      latitude: roundCoordinate(location.latitude),
      longitude: roundCoordinate(location.longitude),
      radiusMiles: clampRadiusMiles(radiusMiles)
    }, options);
  }

  function researchBusiness(place, options) {
    const rawWebsite = String(place?.website || "").trim();
    const website = safeHttpUrl(rawWebsite);
    if (rawWebsite && !website) return Promise.reject(new Error("Enter a valid public website URL."));
    return request("/v1/research", {
      placeId: String(place?.id || "").slice(0, 300),
      name: String(place?.name || "").slice(0, 160),
      address: String(place?.address || "").slice(0, 300),
      latitude: roundCoordinate(place?.latitude),
      longitude: roundCoordinate(place?.longitude),
      website
    }, options);
  }

  function monthYear(date = new Date()) {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
  }

  function auditFromResearch(result, idFactory = () => `b${Math.random().toString(36).slice(2, 9)}`) {
    const business = result?.business || {};
    const evidence = Array.isArray(result?.evidence) ? result.evidence : [];
    const observed = evidence
      .filter(item => item?.detail && item?.sourceUrl)
      .map(item => ({
        tag: String(item.label || item.category || "Observed").slice(0, 40),
        text: String(item.detail).slice(0, 500),
        sourceUrl: safeHttpUrl(item.sourceUrl),
        sourceLabel: String(item.sourceLabel || "Public source").slice(0, 80),
        observedAt: String(item.observedAt || result?.researchedAt || "")
      }))
      .filter(item => item.sourceUrl);

    const systems = Array.isArray(result?.systems) ? result.systems : [];
    const surfaces = [...new Set(systems.map(item => String(item?.name || "").trim()).filter(Boolean))];
    const categoryParts = [business.primaryCategory || "Restaurant", business.address].filter(Boolean);

    return {
      id: idFactory(),
      type: "food",
      name: String(business.name || "New restaurant").slice(0, 160),
      category: categoryParts.join(" · ").slice(0, 320),
      date: monthYear(),
      observed: observed.length ? observed : [{ tag: "Research", text: "No public operating-system evidence was confirmed yet." }],
      commissionLow: 0.15,
      commissionMid: 0.25,
      commissionHigh: 0.30,
      directRate: 0.035,
      surfaces,
      ask: "A free 15-minute look",
      research: {
        status: "draft",
        researchedAt: String(result?.researchedAt || ""),
        provider: "Geoapify / OpenStreetMap and public website",
        website: safeHttpUrl(business.website),
        phone: String(business.phone || "").slice(0, 80),
        placeId: String(business.id || "").slice(0, 300),
        questions: Array.isArray(result?.questions)
          ? result.questions.map(value => String(value).slice(0, 300)).slice(0, 8)
          : []
      }
    };
  }

  global.UnderstudyDiscovery = Object.freeze({
    CONFIG_KEY,
    CONSENT_KEY,
    DEFAULT_SERVICE_URL,
    normalizeServiceUrl,
    loadConfig,
    saveConfig,
    clearConfig,
    hasConsent,
    grantConsent,
    revokeConsent,
    roundCoordinate,
    getApproximateLocation,
    clampRadiusMiles,
    searchBusinesses,
    researchBusiness,
    auditFromResearch
  });
  // Lets Node tests require this file; browsers ignore it.
  if (typeof module === "object" && module.exports) module.exports = global.UnderstudyDiscovery;
})(globalThis);
