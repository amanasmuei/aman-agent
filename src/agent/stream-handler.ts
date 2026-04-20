import { marked } from "marked";
import logUpdate from "log-update";
import type { StreamChunk } from "../llm/types.js";

export interface StreamHandler {
  /** Pass to `client.chat(...)` as the onChunk callback. */
  handler: (chunk: StreamChunk) => void;
  /** Read the currently buffered partial response (used by abort handling). */
  getBuffer: () => string;
  /** Clear the buffer (used after abort flushes partial response to messages). */
  resetBuffer: () => void;
}

/**
 * Factory for the LLM chunk handler. Buffers streamed text while live-updating
 * the terminal via log-update, then on `done` renders the full response as
 * markdown (when stdout is a TTY) or emits a trailing newline (when piped).
 *
 * The buffer is exposed via getBuffer/resetBuffer because `runAgent`'s abort
 * handler may interrupt mid-stream and needs to salvage the partial response
 * into the conversation history before clearing.
 */
export function createStreamHandler(): StreamHandler {
  let responseBuffer = "";

  const handler = (chunk: StreamChunk) => {
    if (chunk.type === "text" && chunk.text) {
      responseBuffer += chunk.text;
      if (process.stdout.isTTY) {
        logUpdate(responseBuffer);
      } else {
        process.stdout.write(chunk.text);
      }
    }
    if (chunk.type === "done") {
      if (process.stdout.isTTY && responseBuffer.trim()) {
        try {
          const rendered = marked(responseBuffer.trim()) as string;
          logUpdate(rendered);
          logUpdate.done();
        } catch {
          logUpdate.done();
        }
      } else {
        process.stdout.write("\n");
      }
      responseBuffer = "";
    }
  };

  return {
    handler,
    getBuffer: () => responseBuffer,
    resetBuffer: () => { responseBuffer = ""; },
  };
}
