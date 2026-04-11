import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { findAgent } from "./server/registry.js";
import type { DelegationResult } from "./delegate.js";
import { log } from "./logger.js";

export interface RemoteDelegateOptions {
  context?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Dial another aman-agent running as an A2A server on the same machine
 * and run a task through its `agent.delegate` MCP tool. Returns a
 * DelegationResult matching the shape of the local `delegateTask` so
 * callers can treat local and remote delegation uniformly.
 *
 * Trust model: same user, same machine — bearer comes from the local
 * registry file (mode 0600). See plan docs for the broader discussion.
 */
export async function delegateRemote(
  task: string,
  agentName: string,
  options: RemoteDelegateOptions = {},
): Promise<DelegationResult> {
  const entry = await findAgent(agentName);
  if (!entry) {
    return {
      profile: `@${agentName}`,
      task,
      response: "",
      toolsUsed: [],
      turns: 0,
      success: false,
      error: `agent not found: ${agentName}`,
    };
  }

  const url = new URL(`http://127.0.0.1:${entry.port}/mcp`);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: { Authorization: `Bearer ${entry.token}` },
    },
    // Disable SSE reconnection scheduling. On close(), the SDK aborts
    // the controller; without this override, the SSE stream's error
    // handler races to schedule a new _reconnectionTimeout AFTER close()
    // cleared the old one, and the timer (plus its referenced socket)
    // pins Node's event loop until the undici keepalive times out. A
    // delegateRemote caller then can't exit cleanly. maxRetries: 0
    // drops the schedule-on-error path entirely; we're doing a single
    // RPC, not a persistent stream, so reconnection has no value here.
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1,
      maxReconnectionDelay: 1,
      reconnectionDelayGrowFactor: 1,
    },
  });
  const client = new Client({ name: "aman-agent-a2a-caller", version: "0.1.0" });

  try {
    await client.connect(transport);

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const call = client.callTool({
      name: "agent.delegate",
      arguments: {
        task,
        ...(options.context ? { context: options.context } : {}),
      },
    });

    // Promise.race picks a winner but does NOT cancel the losing promise's
    // resources. Capturing the timer id lets us clear it after the call
    // resolves — otherwise the setTimeout keeps a Timeout handle alive for
    // the full timeoutMs (120 s default) and pins Node's event loop long
    // after the caller thinks the RPC is done. Equivalent effect to using
    // AbortSignal.timeout() but keeps the existing error message.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timeoutId = setTimeout(
        () => rej(new Error(`remote delegate timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    let result;
    try {
      result = await Promise.race([call, timeout]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    const text = Array.isArray(result.content)
      ? (result.content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("")
      : "";

    // MCP tool-level errors arrive as { isError: true, content: [{text: "..."}] }.
    // Surface them distinctly from JSON.parse failures and from empty responses.
    if ((result as { isError?: boolean }).isError) {
      return {
        profile: `@${agentName}`,
        task,
        response: "",
        toolsUsed: [],
        turns: 0,
        success: false,
        error: `remote tool error: ${text || "(no details)"}`,
      };
    }

    const parsed = text ? JSON.parse(text) : { ok: false, error: "empty response" };

    log.debug("delegate-remote", `@${agentName} ok=${parsed.ok}`);

    if (!parsed.ok) {
      return {
        profile: `@${agentName}`,
        task,
        response: "",
        toolsUsed: [],
        turns: 0,
        success: false,
        error: parsed.error ?? "unknown remote error",
      };
    }

    return {
      profile: `@${agentName}`,
      task,
      response: parsed.text ?? "",
      toolsUsed: parsed.tools_used ?? [],
      turns: parsed.turns ?? 0,
      success: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    const normalized =
      lower.includes("401") || lower.includes("unauthor")
        ? `unauthorized: ${msg}`
        : msg;
    return {
      profile: `@${agentName}`,
      task,
      response: "",
      toolsUsed: [],
      turns: 0,
      success: false,
      error: normalized,
    };
  } finally {
    // Teardown order matters:
    //   1. terminateSession() sends an MCP DELETE to drop the server-side
    //      session. This needs the transport's abort controller to still
    //      be alive, so it MUST run BEFORE client.close() (which aborts
    //      the controller). Earlier order threw DOMException[AbortError].
    //   2. client.close() then releases SDK-side state and aborts the
    //      transport. Combined with reconnectionOptions: { maxRetries: 0 }
    //      on construction, this leaves zero handles pinning the event
    //      loop — verified via process.getActiveResourcesInfo() === [].
    //   3. transport.close() is a no-op after client.close() (which
    //      transitively closes the transport) but kept for symmetry.
    // All three are best-effort: any throw here is swallowed so a
    // teardown failure never masks a real result from the caller.
    try { await transport.terminateSession(); } catch { /* best effort */ }
    try { await client.close(); } catch { /* best effort */ }
    try { await transport.close(); } catch { /* best effort */ }
  }
}
