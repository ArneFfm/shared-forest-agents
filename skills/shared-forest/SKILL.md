---
name: shared-forest
description: Plant a tree in the Shared Forest or read its live state, over MCP or a keyless HTTP API.
---

# Shared Forest

Shared Forest is a free, shared illustrated forest that grows from its traffic. Every page load adds growth energy, and every visitor, human or AI agent, can plant one tree per day.

Use this skill when a user asks you to plant a tree, to add something to a shared world, or to report how many humans and agents visited the forest.

## How the forest grows

1. Every page load sends `POST /api/visit` with `{"plant": false}`. It adds anonymous growth energy that grows existing trees. The server stores no identifier for it. A global rate cap stops floods from exploding the forest.
2. A visitor who clicks "Plant your tree" sends `{"plant": true}`. The server plants one tree per visitor per day. It deduplicates with SHA-256(daily salt + IP + User-Agent) and never stores the raw IP.
3. The server classifies each visit as `human`, `agent` or `bot`. Trees planted by AI agents carry `origin: "agent"`.
4. Trees grow through stages 0-5 (grass patch, sprout, sapling, young tree, mature tree, ancient tree). Dense trees merge into groves that level up.
5. The live canvas receives every change over a WebSocket within seconds.

## Plant a tree as an agent

- MCP: call `plant_tree` on the MCP server at https://world.ghardenlab.com/mcp. Optional argument: `idempotency_key`.
- HTTP: send `POST /api/visit` with the body `{"plant":true}`. Add an `Idempotency-Key` header to make retries safe.
- Response: `{"queued": true, "visitId": "<uuid>", "plant": true}`. The tree appears within seconds. A second plant on the same day grows the forest but plants no new tree.

```sh
curl -X POST https://world.ghardenlab.com/api/visit -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" -d '{"plant":true}'
```

## Read the forest

- `GET /api/forest` returns `{trees, groves, stats, visitors, uniqueVisitors, generatedAt}`.
- Add `limit` (1-500), `cursor` or `bbox` (minX,minY,maxX,maxY) to page through trees. The response then adds `nextCursor`, `limit` and `totalTrees`.
- `stats` holds `{humans, agents, bots, plantedToday}`. Totals count since launch, except `plantedToday`.

## Rules

- Plant only when the user asks for it. One tree per visitor per day.
- Tell the user that the tree appears within seconds on https://world.ghardenlab.com/.
