import { describe, it, expect } from "vitest";
import { humanizeError } from "../src/errors.js";

describe("errors", () => {
  describe("humanizeError", () => {
    it("maps rate limit errors", () => {
      expect(humanizeError("Rate limit exceeded")).toBe("Rate limited. I'll retry automatically.");
    });
    it("maps 401 errors", () => {
      expect(humanizeError("401 Unauthorized")).toBe("API key invalid. Run /reconfig to fix.");
    });
    it("maps 403 errors", () => {
      expect(humanizeError("403 Forbidden")).toBe("API key doesn't have access to this model. Try a different model with --model.");
    });
    it("maps fetch failed errors", () => {
      expect(humanizeError("fetch failed")).toBe("Network error. Check your internet connection.");
    });
    it("maps ECONNREFUSED errors", () => {
      expect(humanizeError("ECONNREFUSED")).toBe("Can't reach the API. Are you behind a proxy or firewall?");
    });
    it("maps context length errors", () => {
      expect(humanizeError("context_length_exceeded")).toBe("Conversation too long. Use /clear to start fresh or I'll auto-trim.");
    });
    it("maps overloaded errors", () => {
      expect(humanizeError("overloaded_error")).toBe("API is overloaded. Retrying in a moment...");
    });
    it("returns original message for unknown errors", () => {
      expect(humanizeError("something weird")).toBe("something weird");
    });
    it("is case-insensitive for matching", () => {
      expect(humanizeError("rate LIMIT exceeded")).toBe("Rate limited. I'll retry automatically.");
    });
  });
});
