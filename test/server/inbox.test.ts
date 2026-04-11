import { describe, it, expect } from "vitest";
import { Inbox } from "../../src/server/inbox.js";

describe("Inbox", () => {
  it("empty-state: peek() returns [] and count is 0", () => {
    const inbox = new Inbox();
    expect(inbox.peek()).toEqual([]);
    expect(inbox.count).toBe(0);
  });

  it("enqueue-then-peek: subsequent peek() includes the message; count is 1", () => {
    const inbox = new Inbox();
    inbox.enqueue({ from: "user", body: "hello" });
    const peeked = inbox.peek();
    expect(peeked).toHaveLength(1);
    expect(peeked[0].from).toBe("user");
    expect(peeked[0].body).toBe("hello");
    expect(inbox.count).toBe(1);
  });

  it("drain-empties: after enqueuing 2 messages, drain() returns both and afterwards peek() and count are empty", () => {
    const inbox = new Inbox();
    inbox.enqueue({ from: "user", body: "first" });
    inbox.enqueue({ from: "other-agent", body: "second" });
    const drained = inbox.drain();
    expect(drained).toHaveLength(2);
    expect(inbox.peek().length).toBe(0);
    expect(inbox.count).toBe(0);
  });

  it("fifo-order: drain() returns messages in enqueue order", () => {
    const inbox = new Inbox();
    inbox.enqueue({ from: "user", body: "a" });
    inbox.enqueue({ from: "user", body: "b" });
    inbox.enqueue({ from: "user", body: "c" });
    const drained = inbox.drain();
    expect(drained.map((m) => m.body)).toEqual(["a", "b", "c"]);
  });
});
