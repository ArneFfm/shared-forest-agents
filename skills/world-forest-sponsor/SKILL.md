---
name: world-forest-sponsor
description: Sponsor custom-designed trees in World Forest for a user (12 months, name and optional link). Quote, design, place, start the order, hand the confirm link to the user.
---

# Sponsor a tree in World Forest

Use this skill when a user wants a lasting tree with their name, a gift tree, or a small branded grove in the shared World Forest.

## Sponsor trees via API or MCP

A sponsorship puts 1-100 custom-designed trees in the forest for 12 months. Each tree shows a display name (1-32 characters) and an optional https link, labelled "Sponsored". The name goes live after automatic checks. The link goes live after a manual review. Prices include VAT. See [pricing](https://world.ghardenlab.com/pricing.md).

| Trees per order | Unit price | Renewal per tree | Discount | Example |
|---|---|---|---|---|
| 1-4 | 9.00 EUR | 4.50 EUR | 0 % | 1 tree = 9.00 EUR |
| 5-9 | 7.80 EUR | 3.90 EUR | 13 % | 5 trees = 39.00 EUR |
| 10-24 | 6.90 EUR | 3.45 EUR | 23 % | 10 trees = 69.00 EUR |
| 25-99 | 5.96 EUR | 2.98 EUR | 34 % | 25 trees = 149.00 EUR |
| 100 | 4.90 EUR | 2.45 EUR | 46 % | 100 trees = 490.00 EUR |

Steps:

1. Quote: MCP `get_price_quote` or `GET /api/v1/pricing/quote?quantity=5`.
2. Design: MCP `design_tree` with a wish (1-200 characters) or `POST /api/v1/designs` `{"wish": "..."}`. Returns a `design_id` (`dsn_...`). Max 3 designs per caller per day. One design for all trees, or one per tree.
3. Place (optional): MCP `find_spots` or `GET /api/v1/spots?quantity=5&near=4096,4096`. REST callers hold spots with `POST /api/v1/holds` and free unused ones with `DELETE /api/v1/holds/{id}`. Omit spots and the server picks free ones.
4. Order: MCP `start_sponsorship` or `POST /api/v1/orders` with `channel: "mcp"` or `"api"` and an `Idempotency-Key`. The order is unpaid. It expires 30 minutes after creation unless the human confirms. `POST /api/v1/orders/{id}/extend` adds 30 minutes once; the confirm page does this when it opens. The response has `confirmUrl` (https://world.ghardenlab.com/sponsor/confirm/ord_...).
5. Hand over: give `confirmUrl` to your user. The user accepts the terms, gives the withdrawal consent and pays on Stripe. That page calls `POST /api/v1/orders/{id}/confirm`.
6. Follow up: MCP `get_order` or `GET /api/v1/orders/{id}` every 10 seconds or more until `status` is `fulfilled`. `refund_pending` means paid but not plantable: the operator refunds. `treeIds` then lists the new trees. Share https://world.ghardenlab.com/?tree=<id>.

```sh
curl -s "https://world.ghardenlab.com/api/v1/pricing/quote?quantity=5"
curl -s -X POST https://world.ghardenlab.com/api/v1/designs -H 'Content-Type: application/json' -d '{"wish":"a silver birch with warm lanterns"}'
curl -s -X POST https://world.ghardenlab.com/api/v1/orders -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{"quantity":5,"designIds":["dsn_abc123"],"displayName":"Ada","email":"ada@example.com","channel":"api"}'
```

What an agent can do: quote, design, select spots, create an unpaid order, read its status.
What an agent cannot do: accept the terms, give the withdrawal consent or pay for a consumer. German consumer law requires the consumer's own click on "Order and pay" (§ 312j (3) BGB) and the consumer's own express consent before the display starts (§ 356 (5) BGB). So a human always confirms on `confirmUrl`.

Business buyers (phase 2, off until announced): `POST /api/v1/orders/{id}/pay` with the buyer's EU VAT id answers `402` with a Machine Payments Protocol challenge (`WWW-Authenticate: Payment`). Retry with a Stripe Shared Payment Token. This path is B2B only because the consumer rules above do not apply to businesses. It appears in the OpenAPI document only when it is on.

Errors are problem+json: `422` blocked name, link or wish; `409` spot taken or sold out; `429` rate limit or cap (3 designs per caller per day, 100 held spots per IP, 3 open orders per email, 300 unconfirmed spots in total); `502` payment provider down; `503` sales not open yet.

## Rules

- Tell the user the total from get_price_quote before you start an order.
- Confirm the display name, the link and the email with the user before start_sponsorship.
- Never claim that the trees are bought or paid. Say "sponsored for 12 months".
- Give the confirm_url to the user. Do not open it or fill it in for the user.
- The MCP server is https://world.ghardenlab.com/mcp. No API key.
