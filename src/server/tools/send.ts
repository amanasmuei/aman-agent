import type { Inbox } from "../inbox.js";

export interface SendInput {
  from?: string;
  topic?: string;
  body: string;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

const MAX_BODY_BYTES = 8 * 1024;

/**
 * Handler for the `agent.send` MCP tool. Validates a one-way message
 * and enqueues it on the target agent's inbox. Messages sit in-memory
 * until the agent drains them at the start of its next user turn.
 *
 * Not durable — if the agent crashes before drain, the message is lost.
 */
export function sendHandler(inbox: Inbox, input: SendInput): SendResult {
  if (!input.body || input.body.trim() === "") {
    return { ok: false, error: "empty body" };
  }
  if (Buffer.byteLength(input.body, "utf8") > MAX_BODY_BYTES) {
    return { ok: false, error: "body too large" };
  }
  const msg = inbox.enqueue({
    from: input.from ?? "unknown",
    topic: input.topic,
    body: input.body,
  });
  return { ok: true, id: msg.id };
}
