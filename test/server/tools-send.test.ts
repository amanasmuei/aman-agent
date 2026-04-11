import { describe, it, expect } from "vitest";
import { Inbox } from "../../src/server/inbox.js";
import { sendHandler } from "../../src/server/tools/send.js";

describe("sendHandler", () => {
  it("enqueue-success: valid message is enqueued and returns {ok:true, id}", () => {
    const inbox = new Inbox();
    const result = sendHandler(inbox, { from: "user", body: "hi" });
    expect(result.ok).toBe(true);
    expect(result.id).toBe("inbox-1");
    expect(result.error).toBeUndefined();
    expect(inbox.count).toBe(1);
  });

  it("reject-empty-body: empty and whitespace-only bodies are rejected without enqueueing", () => {
    const inbox = new Inbox();
    const emptyResult = sendHandler(inbox, { body: "" });
    expect(emptyResult.ok).toBe(false);
    expect(emptyResult.error).toBe("empty body");
    expect(inbox.count).toBe(0);

    const whitespaceResult = sendHandler(inbox, { body: "   " });
    expect(whitespaceResult.ok).toBe(false);
    expect(whitespaceResult.error).toBe("empty body");
    expect(inbox.count).toBe(0);
  });

  it("reject-body-too-large: >8 KiB rejected, exactly 8 KiB accepted", () => {
    const inbox = new Inbox();

    const tooBig = sendHandler(inbox, { body: "x".repeat(8 * 1024 + 1) });
    expect(tooBig.ok).toBe(false);
    expect(tooBig.error).toBe("body too large");
    expect(inbox.count).toBe(0);

    const exact = sendHandler(inbox, { body: "x".repeat(8 * 1024) });
    expect(exact.ok).toBe(true);
    expect(exact.id).toBeDefined();
    expect(inbox.count).toBe(1);
  });
});
