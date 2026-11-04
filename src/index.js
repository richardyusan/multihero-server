import { DurableObject } from "cloudflare:workers";
import { regionHint } from "./regions.js";

const MAX_PLAYERS = 4;
const MIN_PLAYERS_TO_START = 2;
const MAX_MSG_BYTES = 512;
const RATE_PER_SEC = 30;
const BURST = 40;
const MAX_DROPS = 300;

// rooms are placed in the region of their server (first letter of the code), see regions.js
function roomStub(env, code) {
  const id = env.ROOM.idFromName(code);
  const hint = regionHint(code);
  return hint ? env.ROOM.get(id, { locationHint: hint }) : env.ROOM.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // GET /where/<CODE>: data center the room runs in (to check the regions)
    const w = url.pathname.match(/^\/where\/([A-Za-z0-9]{4,8})$/);
    if (w) {
      const code = w[1].toUpperCase();
      return roomStub(env, code).fetch(new Request("https://room.internal/where?code=" + code));
    }
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})$/);
    if (!m) return new Response("Multihero server OK");
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    return roomStub(env, m[1].toUpperCase()).fetch(request);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.started = false;
    this.buckets = new Map();
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }

  players() {
    return this.ctx.getWebSockets()
      .filter((ws) => ws.readyState === 1)
      .map((ws) => ({ ws, ...(ws.deserializeAttachment() || {}) }))
      .filter((p) => p.pid && !p.gone);
  }

  async fetch(request) {
    if (new URL(request.url).pathname === "/where") return this.where(request);
    const list = this.players();
    if (list.length === 0) this.started = false;
    if (this.started) return new Response("Game already started", { status: 409 });
    if (list.length >= MAX_PLAYERS) return new Response("Room full", { status: 403 });

    const used = new Set(list.map((p) => p.slot));
    let slot = 1;
    while (used.has(slot)) slot++;

    const [client, server] = Object.values(new WebSocketPair());
    const pid = crypto.randomUUID().slice(0, 8);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid, slot, ready: false });

    const all = list.map((p) => ({ id: p.pid, slot: p.slot, ready: p.ready }));
    all.push({ id: pid, slot, ready: false });
    const host = all.reduce((a, b) => (a.slot < b.slot ? a : b)).id;

    server.send(JSON.stringify({ t: "welcome", id: pid, slot, host, players: all }));
    this.broadcast({ t: "join", id: pid, slot }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // the colo of a request made from inside the object = the data center it runs in
  async where(request) {
    const code = new URL(request.url).searchParams.get("code") || "";
    let colo = "?";
    try {
      const t = await (await fetch("https://cloudflare.com/cdn-cgi/trace")).text();
      const c = t.match(/^colo=(\w+)/m);
      if (c) colo = c[1];
    } catch {}
    return new Response(JSON.stringify({ code, hint: regionHint(code) || null, colo, players: this.players().length }), {
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    });
  }

  allow(pid) {
    const now = Date.now();
    let b = this.buckets.get(pid);
    if (!b) { b = { tokens: BURST, last: now, drops: 0 }; this.buckets.set(pid, b); }
    b.tokens = Math.min(BURST, b.tokens + ((now - b.last) / 1000) * RATE_PER_SEC);
    b.last = now;
    if (b.tokens >= 1) { b.tokens -= 1; return true; }
    b.drops++;
    return false;
  }

  webSocketMessage(ws, message) {
    const me = ws.deserializeAttachment();
    if (!me || me.gone) return;
    if (!this.allow(me.pid)) {
      if (this.buckets.get(me.pid).drops > MAX_DROPS) {
        try { ws.close(1008, "rate limit"); } catch {}
      }
      return;
    }
    if (typeof message !== "string" || message.length > MAX_MSG_BYTES) return;
    let data;
    try { data = JSON.parse(message); } catch { return; }

    if (data && data.t === "ready") return this.setReady(ws, me);
    this.broadcast({ t: "msg", from: me.pid, slot: me.slot, ts: Date.now(), d: data }, ws);
  }

  setReady(ws, me) {
    if (this.started || me.ready) return;
    me.ready = true;
    ws.serializeAttachment(me);
    this.broadcast({ t: "ready", id: me.pid });
    const list = this.players();
    if (list.length >= MIN_PLAYERS_TO_START && list.every((p) => p.ready)) {
      this.started = true;
      this.broadcast({
        t: "start",
        seed: Math.floor(Math.random() * 2147483647),
        ts: Date.now(),
        players: list.map((p) => ({ id: p.pid, slot: p.slot })),
      });
    }
  }

  webSocketClose(ws, code, reason) {
    const me = ws.deserializeAttachment();
    if (me && !me.gone) {
      me.gone = true;
      try { ws.serializeAttachment(me); } catch {}
      this.buckets.delete(me.pid);
      const rest = this.players().filter((p) => p.ws !== ws);
      this.broadcast({ t: "leave", id: me.pid, slot: me.slot }, ws);
      if (rest.length === 0) {
        this.started = false;
      } else {
        const host = rest.reduce((a, b) => (a.slot < b.slot ? a : b));
        if (me.slot < host.slot) this.broadcast({ t: "host", id: host.pid }, ws);
      }
    }
    try { ws.close(code, reason); } catch {}
  }

  webSocketError(ws) {
    this.webSocketClose(ws, 1011, "error");
  }

  broadcast(obj, except) {
    const text = JSON.stringify(obj);
    for (const p of this.players()) {
      if (p.ws === except) continue;
      try { p.ws.send(text); } catch {}
    }
  }
}
