import assert from "node:assert/strict";
import { test } from "node:test";

import { SharedForestClient, SharedForestError, WorldForestClient, WorldForestError } from "../index.js";

const ORDER = {
  id: "ord_test1", status: "open", quantity: 2, unitAmount: 900, total: 1800, currency: "eur", channel: "api",
  checkoutUrl: null, confirmUrl: "https://forest.example/sponsor/confirm/ord_test1", treeIds: [], createdAt: 1, paidAt: null,
};

/** fetch stub: records requests, answers from a route table. */
function stub(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname + u.search, body: init.body && JSON.parse(init.body), headers: init.headers });
    const handler = routes[`${init.method} ${u.pathname}`];
    if (!handler) return new Response(JSON.stringify({ type: "about:blank", title: "Not Found", status: 404, detail: "nope" }), { status: 404 });
    return handler(u, init);
  };
  return { calls, client: new SharedForestClient({ baseUrl: "https://forest.example/", fetch }) };
}

test("getForest and listTrees send query parameters to /api/v1/forest", async () => {
  const { calls, client } = stub({ "GET /api/v1/forest": () => Response.json({ trees: [], nextCursor: null }) });
  await client.getForest();
  await client.listTrees({ limit: 5, cursor: "abc", bbox: [0, 0, 10, 10] });
  assert.equal(calls[0].path, "/api/v1/forest");
  assert.equal(calls[1].path, "/api/v1/forest?limit=5&cursor=abc&bbox=0%2C0%2C10%2C10");
});

test("plant posts {plant:true} with the Idempotency-Key", async () => {
  const { calls, client } = stub({ "POST /api/v1/visit": () => Response.json({ queued: true, visitId: "v", plant: true }) });
  assert.equal((await client.plant({ idempotencyKey: "k1" })).visitId, "v");
  assert.deepEqual(calls[0].body, { plant: true });
  assert.equal(calls[0].headers["Idempotency-Key"], "k1");
});

test("quote, designTree and findSpots hit the sponsorship endpoints", async () => {
  const { calls, client } = stub({
    "GET /api/v1/pricing/quote": () => Response.json({ quantity: 5, total: 3900 }),
    "POST /api/v1/designs": () => Response.json({ id: "dsn_1" }),
    "GET /api/v1/spots": () => Response.json({ spots: [{ x: 1, y: 2 }] }),
  });
  assert.equal((await client.quote(5)).total, 3900);
  assert.equal((await client.designTree("a birch")).id, "dsn_1");
  await client.findSpots(2, { near: { x: 4000, y: 4100 } });
  assert.equal(calls[0].path, "/api/v1/pricing/quote?quantity=5");
  assert.deepEqual(calls[1].body, { wish: "a birch" });
  assert.equal(calls[2].path, "/api/v1/spots?quantity=2&near=4000%2C4100");
});

test("startSponsorship holds spots, then orders with channel api", async () => {
  const { calls, client } = stub({
    "POST /api/v1/holds": (_, init) => Response.json({ holds: JSON.parse(init.body).spots.map((s, i) => ({ id: `hld_${i}`, ...s })), rejected: [] }),
    "POST /api/v1/orders": () => Response.json(ORDER),
  });
  const order = await client.startSponsorship({
    quantity: 2, designIds: ["dsn_1"], spots: [{ x: 1, y: 2 }, { x: 3, y: 4 }], displayName: "Ada", email: "a@b.co", idempotencyKey: "k",
  });
  assert.equal(order.confirmUrl, ORDER.confirmUrl);
  assert.equal(calls[0].headers["Idempotency-Key"], "k:holds");
  assert.deepEqual(calls[1].body.holdIds, ["hld_0", "hld_1"]);
  assert.equal(calls[1].body.channel, "api");
  assert.equal(calls[1].headers["Idempotency-Key"], "k");
  await assert.rejects(client.startSponsorship({ quantity: 1, designIds: ["d"], displayName: "A", email: "a@b.co" }), TypeError);
});

test("startSponsorship raises on rejected spots; API errors carry the problem", async () => {
  const { client } = stub({ "POST /api/v1/holds": () => Response.json({ holds: [], rejected: [{ x: 1, y: 2, reason: "water" }] }) });
  await assert.rejects(
    client.startSponsorship({ quantity: 1, designIds: ["dsn_1"], spots: [{ x: 1, y: 2 }], displayName: "A", email: "a@b.co", idempotencyKey: "k" }),
    (e) => e instanceof SharedForestError && e.status === 409 && /water/.test(e.message),
  );
  const err = await client.getOrder("ord_missing").catch((e) => e);
  assert.equal(err.status, 404);
  assert.equal(err.problem.detail, "nope");
});

test("extendOrder and releaseHold call the new endpoints; a failed order releases its holds", async () => {
  const { calls, client } = stub({
    "POST /api/v1/orders/ord_test1/extend": () => Response.json(ORDER),
    "DELETE /api/v1/holds/hld_0": () => new Response(null, { status: 204 }),
    "POST /api/v1/holds": () => Response.json({ holds: [{ id: "hld_0" }], rejected: [] }),
    "POST /api/v1/orders": () => new Response(JSON.stringify({ status: 429, detail: "3 open orders per email" }), { status: 429 }),
  });
  assert.equal((await client.extendOrder("ord_test1")).id, "ord_test1");
  assert.equal(await client.releaseHold("hld_0"), undefined);
  await assert.rejects(
    client.startSponsorship({ quantity: 1, designIds: ["dsn_1"], spots: [{ x: 1, y: 2 }], displayName: "A", email: "a@b.co", idempotencyKey: "k" }),
    (e) => e.status === 429,
  );
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
    "POST /api/v1/orders/ord_test1/extend",
    "DELETE /api/v1/holds/hld_0",
    "POST /api/v1/holds",
    "POST /api/v1/orders",
    "DELETE /api/v1/holds/hld_0",
  ]);
});

test("waitForOrder polls until the order leaves open and paid", async () => {
  const states = ["open", "paid", "fulfilled"];
  const { calls, client } = stub({ "GET /api/v1/orders/ord_test1": () => Response.json({ ...ORDER, status: states.shift() }) });
  const slept = [];
  const done = await client.waitForOrder("ord_test1", { intervalMs: 10, sleep: async (ms) => slept.push(ms) });
  assert.equal(done.status, "fulfilled");
  assert.equal(calls.length, 3);
  assert.deepEqual(slept, [1000, 1000]);
  const { client: stuck } = stub({ "GET /api/v1/orders/ord_test1": () => Response.json(ORDER) });
  await assert.rejects(stuck.waitForOrder("ord_test1", { intervalMs: 5000, timeoutMs: 1, sleep: async () => {} }), (e) => e.status === 408);
});

test("the names before the rename stay exported", () => {
  assert.equal(WorldForestClient, SharedForestClient);
  assert.equal(WorldForestError, SharedForestError);
});
