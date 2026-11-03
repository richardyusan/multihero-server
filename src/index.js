import { DurableObject } from "cloudflare:workers";

const MAX_PLAYERS = 8;
const MAX_MSG_BYTES = 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})$/);
    if (!m) return new Response("Multihero server OK");
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const stub = env.ROOM.get(env.ROOM.idFromName(m[1].toUpperCase()));
    return stub.fetch(request);
  },
};

export class Room extends DurableObject {
  async fetch(request) {
    const existing = this.ctx.getWebSockets();
    if (existing.length >= MAX_PLAYERS) {
      return new Response("Room full", { status: 403 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    const pid = crypto.randomUUID().slice(0, 8);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid });

    server.send(JSON.stringify({
      t: "welcome",
      id: pid,
      players: existing.map((ws) => ws.deserializeAttachment().pid),
    }));
    this.broadcast({ t: "join", id: pid }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MAX_MSG_BYTES) return;
    let data;
    try { data = JSON.parse(message); } catch { return; }
    const { pid } = ws.deserializeAttachment();
    this.broadcast({ t: "msg", from: pid, d: data }, ws);
  }

  webSocketClose(ws, code, reason) {
    const { pid } = ws.deserializeAttachment();
    this.broadcast({ t: "leave", id: pid }, ws);
    try { ws.close(code, reason); } catch {}
  }

  webSocketError(ws) {
    this.webSocketClose(ws, 1011, "error");
  }

  broadcast(obj, except) {
    const text = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(text); } catch {}
    }
  }
}
