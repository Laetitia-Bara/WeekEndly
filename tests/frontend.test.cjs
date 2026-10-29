const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const frontendSource = readFileSync(resolve(__dirname, "../frontend/script.js"), "utf8");
const workerSource = readFileSync(resolve(__dirname, "../frontend/service-worker.js"), "utf8");
const origin = "https://weekendly.cosmos-lty.fr";

function loadFrontend(url) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        value: id === "#activity" ? "dog" : id === "#duration" ? "2" : "weekend",
        checked: true,
        style: {},
        addEventListener() {},
        appendChild() {},
      });
    }
    return elements.get(id);
  }
  const requests = [];
  const bestSlot = { start: "2026-10-31T09:00:00Z", end: "2026-10-31T11:00:00Z" };
  const location = new URL(url);
  const context = vm.createContext({
    URL,
    location,
    window: { location },
    navigator: {},
    document: { querySelector: element, createElement: () => ({}) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ result: true, bestSlot }) };
    },
  });
  vm.runInContext(frontendSource, context);
  return { context, elements, requests, bestSlot };
}

test("production sends the weather request to the hosted HTTPS API", async () => {
  const { context, requests, bestSlot } = loadFrontend(origin);
  const result = await vm.runInContext("callBackendBestSlot(48.8566, 2.3522, 'dog', 2)", context);
  assert.equal(result, bestSlot);
  assert.equal(requests[0].url, "https://api.weekendly.cosmos-lty.fr/best-slot");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    lat: 48.8566, lon: 2.3522, activity: "dog", duration: 2, windows: null,
  });
});

test("preview domains also use the hosted API", async () => {
  const { context, requests } = loadFrontend("https://weekendly-preview.vercel.app");
  await vm.runInContext("callBackendBestSlot(48.8566, 2.3522, 'dog', 2)", context);
  assert.equal(requests[0].url, "https://api.weekendly.cosmos-lty.fr/best-slot");
});

for (const url of ["http://localhost:5500", "http://127.0.0.1:5500", "http://[::1]:5500", "file:///D:/Weekendly/frontend/index.html"]) {
  test(`local development keeps the local backend (${url})`, async () => {
    const { context, requests } = loadFrontend(url);
    await vm.runInContext("callBackendBestSlot(48.8566, 2.3522, 'dog', 2)", context);
    assert.equal(requests[0].url, "http://localhost:3000/best-slot");
  });
}

test("custom time windows are preserved in the API request", async () => {
  const { context, elements, requests } = loadFrontend(origin);
  elements.get("#mode").value = "custom";
  elements.get("#satStart").value = "10";
  elements.get("#satEnd").value = "14";
  elements.get("#sunStart").value = "12";
  elements.get("#sunEnd").value = "18";
  elements.get("#sunOn").checked = false;
  await vm.runInContext("callBackendBestSlot(48.8566, 2.3522, 'hike', 3)", context);
  assert.deepEqual(JSON.parse(requests[0].options.body).windows, {
    sat: { enabled: true, startHour: 10, endHour: 14 },
    sun: { enabled: false, startHour: 12, endHour: 18 },
  });
});

function workerHarness() {
  const listeners = new Map();
  const stores = new Map();
  const effects = { skipped: 0, claimed: 0, fetched: [], precached: [] };
  const key = (request) => new URL(typeof request === "string" ? request : request.url, `${origin}/`).href;
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async addAll(requests) { effects.precached.push(...requests); },
      async put(request, response) {
        if (effects.failWrites) throw new Error("storage unavailable");
        store.set(key(request), response);
      },
      async match(request) { return store.get(key(request)); },
    };
  };
  const caches = {
    async open(name) { return cacheFor(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request) {
      for (const store of stores.values()) if (store.has(key(request))) return store.get(key(request));
    },
  };
  let network = async () => response("fresh");
  const self = {
    location: new URL(`${origin}/service-worker.js`),
    addEventListener: (type, listener) => listeners.set(type, listener),
    async skipWaiting() { effects.skipped++; },
    clients: { async claim() { effects.claimed++; } },
  };
  vm.runInNewContext(workerSource, {
    self, caches, URL,
    Request: class extends Request {
      constructor(input, options) { super(new URL(input, `${origin}/`), options); }
    },
    fetch: async (request) => { effects.fetched.push(request); return network(request); },
  });
  async function dispatch(type, request) {
    const pending = [];
    let result;
    listeners.get(type)({
      request,
      waitUntil: (promise) => pending.push(promise),
      respondWith: (promise) => { result = promise; },
    });
    const response = result === undefined ? undefined : await result;
    await Promise.all(pending);
    return response;
  }
  return { stores, effects, cacheFor, dispatch, setNetwork(fn) { network = fn; } };
}

function response(text, { ok = true, redirected = false } = {}) {
  return { text, ok, type: "basic", redirected, clone() { return response(text, { ok, redirected }); } };
}

function request(path = "/script.js", method = "GET") {
  return { url: new URL(path, origin).href, method };
}

test("the new worker precaches fresh assets and takes over obsolete Weekendly caches", async () => {
  const worker = workerHarness();
  worker.cacheFor("weekendly-v1");
  worker.cacheFor("other-app-v1");
  await worker.dispatch("install");
  assert.equal(worker.effects.skipped, 1);
  assert.ok(worker.effects.precached.some((entry) => new URL(entry.url ?? entry, `${origin}/`).pathname === "/script.js"));
  assert.ok(worker.effects.precached.every((entry) => entry.cache === "reload"));
  await worker.dispatch("activate");
  assert.equal(worker.stores.has("weekendly-v1"), false);
  assert.equal(worker.stores.has("other-app-v1"), true);
  assert.equal(worker.effects.claimed, 1);
  assert.equal(worker.stores.has("weekendly-v2"), true);
});

test("online JavaScript replaces the cached version", async () => {
  const worker = workerHarness();
  await worker.cacheFor("weekendly-v2").put(request(), response("stale"));
  assert.equal((await worker.dispatch("fetch", request())).text, "fresh");
  assert.equal((await worker.cacheFor("weekendly-v2").match(request())).text, "fresh");
});

test("offline requests fall back to the current cache", async () => {
  const worker = workerHarness();
  await worker.cacheFor("weekendly-v2").put(request(), response("offline copy"));
  worker.setNetwork(async () => { throw new Error("offline"); });
  assert.equal((await worker.dispatch("fetch", request())).text, "offline copy");
});

test("offline requests do not revive the broken v1 JavaScript", async () => {
  const worker = workerHarness();
  await worker.cacheFor("weekendly-v1").put(request(), response("localhost backend"));
  worker.setNetwork(async () => { throw new Error("offline"); });
  await assert.rejects(worker.dispatch("fetch", request()), /offline/);
});

test("API requests and cross-origin weather calls bypass the worker", async () => {
  const worker = workerHarness();
  assert.equal(await worker.dispatch("fetch", request("/best-slot", "POST")), undefined);
  assert.equal(await worker.dispatch("fetch", request("https://api.weekendly.cosmos-lty.fr/best-slot", "POST")), undefined);
  assert.equal(await worker.dispatch("fetch", request("https://api.open-meteo.com/v1/forecast")), undefined);
  assert.equal(worker.effects.fetched.length, 0);
});

test("HTTP errors do not overwrite the offline copy", async () => {
  const worker = workerHarness();
  await worker.cacheFor("weekendly-v2").put(request(), response("offline copy"));
  worker.setNetwork(async () => response("server error", { ok: false }));
  assert.equal((await worker.dispatch("fetch", request())).text, "server error");
  assert.equal((await worker.cacheFor("weekendly-v2").match(request())).text, "offline copy");
});

test("a cache storage failure does not break a successful network response", async () => {
  const worker = workerHarness();
  worker.effects.failWrites = true;
  assert.equal((await worker.dispatch("fetch", request())).text, "fresh");
});

test("redirected responses do not replace cached application assets", async () => {
  const worker = workerHarness();
  await worker.cacheFor("weekendly-v2").put(request(), response("offline copy"));
  worker.setNetwork(async () => response("redirect destination", { redirected: true }));
  assert.equal((await worker.dispatch("fetch", request())).text, "redirect destination");
  assert.equal((await worker.cacheFor("weekendly-v2").match(request())).text, "offline copy");
});
