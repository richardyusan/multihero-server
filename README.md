# multihero-server

Online rooms for [MultiHero Web](https://github.com/richardyusan/multihero-web): a Cloudflare Worker with
one Durable Object per room. The server only relays messages; every browser runs the game itself
(lockstep netplay).

## Servers (regions)

The first letter of a room code decides where the room runs. The Worker passes a
[`locationHint`](https://developers.cloudflare.com/durable-objects/reference/data-location/) when a
room is created; Cloudflare never moves a room afterwards.

| Letter | Lobby name | Region (`locationHint`) | Public rooms |
|---|---|---|---|
| `S` | Server 1 – Asia Tenggara | `apac-se` | `SPUB1` `SPUB2` `SPUB3` |
| `N` | Server 2 – Asia Timur | `apac-ne` | `NPUB1` `NPUB2` `NPUB3` |
| `U` | Server 3 – US | `enam` (Eastern North America) | `UPUB1` `UPUB2` `UPUB3` |
| `E` | Server 4 – Eropa | `weur` (Western Europe) | `EPUB1` `EPUB2` `EPUB3` |

Other letters (old codes such as `PUBLIC1`) get no hint: the room is created near the first player.
The mapping is in [`src/regions.js`](src/regions.js).

## API

| Request | What |
|---|---|
| `GET /` | `Multihero server OK` |
| `wss://…/room/<CODE>` | join room `CODE` (4–8 letters/digits) |
| `GET /where/<CODE>` | JSON `{code, hint, colo, players}` – the data center (`colo`) the room runs in |

Room messages: server → client `welcome`, `join`, `leave`, `host`, `ready`, `start` (shared seed),
`msg` (relayed), `pong`; client → server `{t:"ready"}`, `"ping"`, any other JSON is relayed to the room.
Limits: 4 players, 30 messages/s per player (burst 40), 512 characters per message; a room refuses
new players once its match started, until it is empty again.

## Develop / deploy

```bash
npm ci
npx vitest run       # tests
npx wrangler dev     # local server on http://localhost:8787
npx wrangler deploy  # publish to Cloudflare
```
