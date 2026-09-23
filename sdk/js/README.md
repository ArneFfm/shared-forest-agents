# shared-forest-sdk

Zero-dependency TypeScript/JavaScript client for the [Shared Forest](https://world.ghardenlab.com/) API.
ESM with type declarations. Needs a global `fetch` (Node 18+, Deno, Bun, browsers, Workers).

The package is not on npm yet. Install it from this repository:

```sh
git clone https://github.com/ArneFfm/shared-forest-agents
npm install ./shared-forest-agents/sdk/js
```

The package has two files, `index.js` and `index.d.ts`. You can also copy them.

## Use

```js
import { SharedForestClient } from "shared-forest-sdk";

const forest = new SharedForestClient();
const page = await forest.listTrees({ limit: 50 });

// Sponsor 5 trees for a user. The user confirms and pays on confirmUrl.
const quote = await forest.quote(5);
const design = await forest.designTree("a silver birch with warm lanterns");
const { spots } = await forest.findSpots(5, { near: { x: 4096, y: 4096 } });
const order = await forest.startSponsorship({
  quantity: 5,
  designIds: [design.id],
  spots,
  displayName: "Ada",
  email: "ada@example.com",
  idempotencyKey: crypto.randomUUID(),
});
console.log(`Total ${quote.total / 100} EUR. Confirm and pay: ${order.confirmUrl}`);
const done = await forest.waitForOrder(order.id);
```

| Method | Endpoint |
|---|---|
| `getForest({limit, cursor, bbox})` | `GET /api/v1/forest` |
| `listTrees({limit, cursor, bbox})` | `GET /api/v1/forest?limit=` |
| `plant({idempotencyKey})` | `POST /api/v1/visit` |
| `quote(quantity)` | `GET /api/v1/pricing/quote` |
| `designTree(wish)` | `POST /api/v1/designs` |
| `findSpots(quantity, {near})` | `GET /api/v1/spots` |
| `startSponsorship({...})` | `POST /api/v1/holds`, `POST /api/v1/orders` |
| `getOrder(id)` | `GET /api/v1/orders/{id}` |
| `extendOrder(id)` | `POST /api/v1/orders/{id}/extend` (30 more minutes, once) |
| `releaseHold(id)` | `DELETE /api/v1/holds/{id}` |
| `waitForOrder(id, {intervalMs, timeoutMs})` | polls `getOrder` |

An agent cannot pay for a consumer: German consumer law needs the buyer's own confirmation.
An agent order expires 30 minutes after creation unless the human confirms. `extendOrder` adds 30 minutes once.
Errors throw `SharedForestError` with `status` and the problem+json body in `problem`.

## Test

```sh
npm test
```
