import http from "node:http";
import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/**
 * Handle for a running localhost MCP transport.
 *
 * Downstream code (Task 7 `startAgentServer`) hands `mcpTransport` to
 * `McpServer.connect(...)`. Task 12 (`/agents ping`) uses `port` + `token`
 * to hit the `/health` endpoint. Task 10 (`delegateRemote`) uses them to
 * dial `/mcp` via the MCP client transport.
 */
export interface ServerTransport {
  port: number;
  token: string;
  httpServer: http.Server;
  mcpTransport: StreamableHTTPServerTransport;
  close: () => Promise<void>;
}

/**
 * Check a request's `Authorization: Bearer <token>` header against the
 * expected token. Uses a constant-time comparison to avoid leaking token
 * bytes via response-timing side channels.
 */
function authOk(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers["authorization"];
  if (!header || typeof header !== "string") return false;
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Bind an HTTP server to `127.0.0.1` on an ephemeral port, protected by a
 * freshly generated 32-byte hex bearer token. Routes:
 *
 * - `GET /health` -> `{ ok: true }` (200)
 * - `/mcp*`       -> `StreamableHTTPServerTransport.handleRequest`
 *
 * Every request (including `/health`) requires the bearer — this is
 * intentional; there are no anonymous endpoints.
 *
 * The caller is responsible for calling `close()` when the server is no
 * longer needed; `close()` tears down the MCP transport and frees the port.
 */
export async function createTransport(): Promise<ServerTransport> {
  const token = crypto.randomBytes(32).toString("hex");
  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  const httpServer = http.createServer(async (req, res) => {
    if (!authOk(req, token)) {
      res.statusCode = 401;
      res.setHeader("WWW-Authenticate", "Bearer");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    if (req.url === "/health") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url?.startsWith("/mcp")) {
      await mcpTransport.handleRequest(req, res);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    httpServer.once("error", onError);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", onError);
      resolve();
    });
  });

  const addr = httpServer.address();
  if (!addr || typeof addr === "string") {
    throw new Error("failed to bind localhost port");
  }

  return {
    port: addr.port,
    token,
    httpServer,
    mcpTransport,
    close: async () => {
      try {
        await mcpTransport.close();
      } catch {
        /* ignore — best-effort teardown */
      }
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
