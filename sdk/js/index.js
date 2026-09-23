// World Forest SDK. Zero dependencies. Needs a global fetch (Node 18+, Deno, Bun, browsers, Workers).
// Types: index.d.ts. API reference: https://world.ghardenlab.com/openapi.json

export const DEFAULT_BASE_URL = "https://world.ghardenlab.com";

/** An API error. `problem` holds the RFC 9457 problem+json body when the server sent one. */
export class WorldForestError extends Error {
  constructor(status, problem, message) {
    super(message ?? problem?.detail ?? `World Forest API answered HTTP ${status}`);
    this.name = "WorldForestError";
    this.status = status;
    this.problem = problem ?? null;
  }
}

const OPEN = "open";
const PAID = "paid";

export class WorldForestClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.userAgent = options.userAgent ?? "world-forest-sdk-js/0.1.0";
  }

  async request(method, path, { query, body, idempotencyKey } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { Accept: "application/json", "User-Agent": this.userAgent };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await this.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) throw new WorldForestError(res.status, data && typeof data === "object" ? data : null);
    return data;
  }

  /** Live snapshot. Pass limit, cursor or bbox ([minX, minY, maxX, maxY]) for one page. */
  getForest({ limit, cursor, bbox } = {}) {
    return this.request("GET", "/api/v1/forest", { query: { limit, cursor, bbox: bbox?.join(",") } });
  }

  /** One page of trees. Pass nextCursor as cursor until it is null. */
  listTrees({ limit = 100, cursor, bbox } = {}) {
    return this.getForest({ limit, cursor, bbox });
  }

  /** Plants one tree (one per visitor per day). Call it only when the user asks. */
  plant({ idempotencyKey } = {}) {
    return this.request("POST", "/api/v1/visit", { body: { plant: true }, idempotencyKey });
  }

  /** Price of N sponsored trees for 12 months, euro cents, VAT included. */
  quote(quantity) {
    return this.request("GET", "/api/v1/pricing/quote", { query: { quantity } });
  }

  /** Designs a tree from a wish (1-200 characters). Max 3 per caller per day. */
  designTree(wish) {
    return this.request("POST", "/api/v1/designs", { body: { wish } });
  }

  /** Free spots for N sponsored trees, optionally near {x, y}. */
  findSpots(quantity, { near } = {}) {
    return this.request("GET", "/api/v1/spots", { query: { quantity, near: near ? `${near.x},${near.y}` : undefined } });
  }

  /**
   * Creates an unpaid order. Returns the Order with confirmUrl: give it to the human buyer,
   * who accepts the terms and pays there. With `spots` the SDK holds them first.
   */
  async startSponsorship({ quantity, designIds, spots, holdIds, displayName, link, email, idempotencyKey }) {
    if (!idempotencyKey) throw new TypeError("idempotencyKey is required, for example crypto.randomUUID().");
    let holds = holdIds;
    if (spots?.length) {
      const held = await this.request("POST", "/api/v1/holds", { body: { spots }, idempotencyKey: `${idempotencyKey}:holds` });
      if (held.rejected?.length)
        throw new WorldForestError(409, null, `Spots not free: ${held.rejected.map((r) => `(${r.x}, ${r.y}) ${r.reason}`).join("; ")}`);
      holds = held.holds.map((h) => h.id);
    }
    return this.request("POST", "/api/v1/orders", {
      body: { quantity, designIds, holdIds: holds, displayName, link, email, channel: "api" },
      idempotencyKey,
    });
  }

  getOrder(orderId) {
    return this.request("GET", `/api/v1/orders/${encodeURIComponent(orderId)}`);
  }

  /** Polls getOrder until the order leaves "open" and "paid", or the timeout passes. */
  async waitForOrder(orderId, { intervalMs = 10_000, timeoutMs = 35 * 60_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const order = await this.getOrder(orderId);
      if (order.status !== OPEN && order.status !== PAID) return order;
      if (Date.now() + intervalMs > deadline) throw new WorldForestError(408, null, `Order ${orderId} is still ${order.status} after ${timeoutMs} ms.`);
      await sleep(Math.max(intervalMs, 1000));
    }
  }
}
