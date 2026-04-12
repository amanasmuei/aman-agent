import { describe, it, expect } from "vitest";
import {
  parseDecompositionResponse,
  decomposeRequirement,
} from "../../src/orchestrator/decompose.js";
import type { TaskDAG } from "../../src/orchestrator/types.js";
import type {
  LLMClient,
  ChatResponse,
  StreamChunk,
  Message,
} from "../../src/llm/types.js";

// ── Fixtures ───────────────────────────────────────────────────────

const VALID_DAG: TaskDAG = {
  id: "orch-auth",
  name: "Auth feature",
  goal: "Add login/signup",
  nodes: [
    {
      id: "t1",
      name: "Design API",
      description: "Design auth endpoints",
      profile: "architect",
      tier: "advanced",
      dependencies: [],
    },
    {
      id: "t2",
      name: "Implement API",
      description: "Build auth endpoints",
      profile: "coder",
      tier: "standard",
      dependencies: ["t1"],
    },
    {
      id: "t3",
      name: "Write tests",
      description: "Test auth endpoints",
      profile: "tester",
      tier: "standard",
      dependencies: ["t1"],
    },
  ],
  gates: [
    {
      id: "g1",
      name: "Review before deploy",
      type: "approval",
      afterNodes: ["t2", "t3"],
      beforeNodes: [],
    },
  ],
};

function makeStubClient(responseText: string): LLMClient {
  return {
    async chat(
      _sys: string,
      _msgs: Message[],
      onChunk: (chunk: StreamChunk) => void,
    ): Promise<ChatResponse> {
      onChunk({ type: "text", text: responseText });
      onChunk({ type: "done" });
      return {
        message: { role: "assistant", content: responseText },
        toolUses: [],
      };
    },
  };
}

// ── parseDecompositionResponse ──────────────────────────────────────

describe("parseDecompositionResponse", () => {
  it("parses valid JSON DAG", () => {
    const json = JSON.stringify(VALID_DAG);
    const result = parseDecompositionResponse(json);
    expect(result.id).toBe("orch-auth");
    expect(result.nodes).toHaveLength(3);
    expect(result.gates).toHaveLength(1);
  });

  it("extracts JSON from markdown code block", () => {
    const wrapped = `Here is the task DAG:\n\n\`\`\`json\n${JSON.stringify(VALID_DAG, null, 2)}\n\`\`\`\n\nLet me know if you need changes.`;
    const result = parseDecompositionResponse(wrapped);
    expect(result.id).toBe("orch-auth");
    expect(result.nodes).toHaveLength(3);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseDecompositionResponse("not json at all")).toThrow();
  });

  it("throws on valid JSON that doesn't match schema", () => {
    const invalid = JSON.stringify({ id: "x", name: "y" }); // missing goal, nodes
    expect(() => parseDecompositionResponse(invalid)).toThrow();
  });
});

// ── decomposeRequirement ────────────────────────────────────────────

describe("decomposeRequirement", () => {
  it("calls LLM and returns valid DAG", async () => {
    const client = makeStubClient(JSON.stringify(VALID_DAG));
    const result = await decomposeRequirement("Add auth feature", client);
    expect(result.id).toBe("orch-auth");
    expect(result.nodes).toHaveLength(3);
  });

  it("throws if LLM returns unparseable response", async () => {
    const client = makeStubClient("I cannot help with that request.");
    await expect(
      decomposeRequirement("Do something", client),
    ).rejects.toThrow();
  });
});
