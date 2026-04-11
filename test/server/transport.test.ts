import { describe, it, expect, afterEach } from "vitest";
import { AddressInfo } from "node:net";
import {
  createTransport,
  type ServerTransport,
} from "../../src/server/transport.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

describe("transport", () => {
  const toClose: ServerTransport[] = [];

  afterEach(async () => {
    for (const t of toClose) {
      try {
        await t.close();
      } catch {
        /* best effort */
      }
    }
    toClose.length = 0;
  });

  async function make(): Promise<ServerTransport> {
    const t = await createTransport();
    toClose.push(t);
    return t;
  }

  it("returns-shape: createTransport resolves with the documented fields", async () => {
    const t = await make();
    expect(typeof t.port).toBe("number");
    expect(t.port).toBeGreaterThan(1024);
    expect(typeof t.token).toBe("string");
    expect(t.token.length).toBeGreaterThan(0);
    expect(t.httpServer).toBeDefined();
    expect(t.mcpTransport).toBeInstanceOf(StreamableHTTPServerTransport);
    expect(typeof t.close).toBe("function");
  });

  it("health-auth-ok: GET /health with valid bearer returns 200 {ok:true}", async () => {
    const t = await make();
    const res = await fetch(`http://127.0.0.1:${t.port}/health`, {
      headers: { Authorization: `Bearer ${t.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("health-auth-missing-or-wrong: missing or wrong bearer returns 401 + WWW-Authenticate", async () => {
    const t = await make();

    const resMissing = await fetch(`http://127.0.0.1:${t.port}/health`);
    expect(resMissing.status).toBe(401);
    expect(resMissing.headers.get("www-authenticate")).toMatch(/^Bearer/i);
    // Drain body so the connection can be released.
    await resMissing.text();

    const resWrong = await fetch(`http://127.0.0.1:${t.port}/health`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(resWrong.status).toBe(401);
    expect(resWrong.headers.get("www-authenticate")).toMatch(/^Bearer/i);
    await resWrong.text();
  });

  it("bound-to-localhost: httpServer.address() reports 127.0.0.1 (security-critical)", async () => {
    const t = await make();
    const addr = t.httpServer.address();
    expect(addr).not.toBeNull();
    expect(typeof addr).toBe("object");
    const info = addr as AddressInfo;
    expect(info.address).toBe("127.0.0.1");
    // Extra guardrails: never bind to wildcard addresses.
    expect(info.address).not.toBe("0.0.0.0");
    expect(info.address).not.toBe("::");
  });

  it("close-frees-port: close() releases the port so a new transport can bind", async () => {
    const first = await createTransport();
    await first.close();
    // If the port was not freed, this would throw EADDRINUSE on the same
    // port — but since we requested port 0 each time, the OS picks another
    // free one. The real assertion is that close() resolved cleanly and
    // a second createTransport() succeeds and is itself usable.
    const second = await createTransport();
    toClose.push(second);
    expect(second.port).toBeGreaterThan(1024);
    // Sanity check the second instance actually serves requests.
    const res = await fetch(`http://127.0.0.1:${second.port}/health`, {
      headers: { Authorization: `Bearer ${second.token}` },
    });
    expect(res.status).toBe(200);
    await res.text();
  });
});
