import { env, createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";
import { regionHint } from "../src/regions.js";

describe("multihero-server", () => {
	it("answers on /", async () => {
		const ctx = createExecutionContext();
		const response = await worker.fetch(new Request("http://example.com"), env, ctx);
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toBe("Multihero server OK");
	});

	it("wants a WebSocket on /room/<code>", async () => {
		const response = await SELF.fetch("http://example.com/room/SPUB1");
		expect(response.status).toBe(426);
	});

	it("maps the first letter of a room code to a region", () => {
		expect(regionHint("SPUB1")).toBe("apac-se");
		expect(regionHint("nab12")).toBe("apac-ne");
		expect(regionHint("UPUB2")).toBe("enam");
		expect(regionHint("E7K2P")).toBe("weur");
		expect(regionHint("PUBLIC1")).toBeUndefined();
	});

	it("lets two players join a room and starts when both are ready", async () => {
		const open = async () => {
			const res = await SELF.fetch("http://example.com/room/STEST1", { headers: { Upgrade: "websocket" } });
			expect(res.status).toBe(101);
			const ws = res.webSocket;
			const msgs = [];
			ws.addEventListener("message", (e) => { msgs.push(e.data); });
			ws.accept();
			return { ws, msgs };
		};
		const a = await open();
		const b = await open();
		const wait = async (p, f) => { for (let i = 0; i < 50 && !p.msgs.some(f); i++) await new Promise((r) => setTimeout(r, 20)); };
		await wait(b, (m) => m.includes('"welcome"'));
		a.ws.send(JSON.stringify({ t: "ready" }));
		b.ws.send(JSON.stringify({ t: "ready" }));
		await wait(a, (m) => m.includes('"start"'));
		expect(a.msgs.some((m) => m.includes('"start"'))).toBe(true);
		a.ws.close(); b.ws.close();
	});
});
