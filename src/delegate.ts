import pc from "picocolors";
import type {
  LLMClient,
  Message,
  ToolDefinition,
  ToolResultBlock,
  StreamChunk,
} from "./llm/types.js";
import type { McpManager } from "./mcp/client.js";
import { assembleSystemPrompt } from "./prompt.js";
import { withRetry } from "./retry.js";
import { log } from "./logger.js";

export interface DelegationResult {
  profile: string;
  task: string;
  response: string;
  toolsUsed: string[];
  turns: number;
  success: boolean;
  error?: string;
}

export interface DelegateOptions {
  maxTurns?: number;        // max tool loop iterations (default: 10)
  silent?: boolean;         // suppress output (default: false)
  tools?: ToolDefinition[]; // tools available to sub-agent
}

const isRetryable = (err: unknown): boolean => {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes("rate") || msg.includes("timeout") || msg.includes("econnreset");
  }
  return false;
};

/**
 * Run a task with a specific profile as a non-interactive sub-agent.
 * The sub-agent gets its own system prompt (from profile), runs a mini agent loop
 * (LLM → tools → LLM → ...), and returns the final text response.
 *
 * Reuses the parent's LLM client and MCP connections.
 */
export async function delegateTask(
  task: string,
  profile: string,
  client: LLMClient,
  mcpManager: McpManager,
  options: DelegateOptions = {},
): Promise<DelegationResult> {
  const maxTurns = options.maxTurns ?? 10;
  const silent = options.silent ?? false;
  const tools = options.tools;

  try {
    // Load profile-specific system prompt
    const { prompt: systemPrompt } = assembleSystemPrompt(undefined, profile);

    // Build the delegation prompt
    const delegationPrompt = `${systemPrompt}

<delegation>
You are being delegated a specific task by the primary agent. Complete this task thoroughly and return your result. You have access to tools if needed. Focus on the task — do not ask follow-up questions, just do your best with what you have.
</delegation>`;

    const messages: Message[] = [
      { role: "user", content: task },
    ];

    const toolsUsed: string[] = [];
    let turns = 0;

    // Collect streamed text
    const onChunk: (chunk: StreamChunk) => void = silent
      ? () => {}
      : (chunk) => {
          if (chunk.type === "text" && chunk.text) {
            process.stdout.write(chunk.text);
          }
        };

    // Initial LLM call
    let response = await withRetry(
      () => client.chat(delegationPrompt, messages, onChunk, tools),
      { maxAttempts: 2, baseDelay: 1000, retryable: isRetryable },
    );

    messages.push(response.message);

    // Tool loop (same pattern as agent.ts)
    while (response.toolUses.length > 0 && turns < maxTurns) {
      turns++;

      const toolResults: ToolResultBlock[] = await Promise.all(
        response.toolUses.map(async (toolUse) => {
          if (!silent) {
            process.stdout.write(pc.dim(`  [${profile}:${toolUse.name}...]\n`));
          }
          toolsUsed.push(toolUse.name);

          try {
            const result = await mcpManager.callTool(toolUse.name, toolUse.input);
            return {
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: result,
            };
          } catch (err) {
            return {
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: `Error: ${err instanceof Error ? err.message : String(err)}`,
              is_error: true,
            };
          }
        }),
      );

      messages.push({ role: "user", content: toolResults });

      response = await withRetry(
        () => client.chat(delegationPrompt, messages, onChunk, tools),
        { maxAttempts: 2, baseDelay: 1000, retryable: isRetryable },
      );

      messages.push(response.message);
    }

    // Extract final text response
    const finalMessage = response.message;
    const responseText = typeof finalMessage.content === "string"
      ? finalMessage.content
      : finalMessage.content
          .filter((b) => b.type === "text")
          .map((b) => ("text" in b ? b.text : ""))
          .join("");

    return {
      profile,
      task,
      response: responseText,
      toolsUsed: [...new Set(toolsUsed)],
      turns,
      success: true,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn("delegate", `Delegation to ${profile} failed: ${error}`);
    return {
      profile,
      task,
      response: "",
      toolsUsed: [],
      turns: 0,
      success: false,
      error,
    };
  }
}

/**
 * Delegate a task to multiple profiles in parallel.
 * Useful for: write + review, research + summarize, etc.
 */
export async function delegateParallel(
  tasks: Array<{ task: string; profile: string }>,
  client: LLMClient,
  mcpManager: McpManager,
  options: DelegateOptions = {},
): Promise<DelegationResult[]> {
  return Promise.all(
    tasks.map(({ task, profile }) =>
      delegateTask(task, profile, client, mcpManager, { ...options, silent: true }),
    ),
  );
}

/**
 * Delegate a pipeline of tasks sequentially — each task receives the previous result.
 * Useful for: draft → review → polish pipelines.
 */
export async function delegatePipeline(
  steps: Array<{ profile: string; taskTemplate: string }>,
  initialInput: string,
  client: LLMClient,
  mcpManager: McpManager,
  options: DelegateOptions = {},
): Promise<DelegationResult[]> {
  const results: DelegationResult[] = [];
  let previousResult = initialInput;

  for (const step of steps) {
    const task = step.taskTemplate.replace("{{input}}", previousResult);

    if (!options.silent) {
      process.stdout.write(pc.dim(`\n  [delegating to ${step.profile}...]\n`));
    }

    const result = await delegateTask(task, step.profile, client, mcpManager, {
      ...options,
      silent: true,
    });
    results.push(result);

    if (!result.success) break;
    previousResult = result.response;
  }

  return results;
}
