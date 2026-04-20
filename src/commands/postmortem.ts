import pc from "picocolors";
import {
  generatePostmortemReport,
  savePostmortem,
  listPostmortems,
  readPostmortem,
  analyzePostmortemRange,
  formatPostmortemMarkdown,
} from "../postmortem.js";
import type { CommandContext, CommandResult } from "./shared.js";

export async function handlePostmortemCommand(
  action: string | undefined,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  switch (action) {
    case "last": {
      const files = await listPostmortems();
      if (files.length === 0) return { handled: true, output: pc.dim("No post-mortems found.") };
      const content = await readPostmortem(files[0]);
      return { handled: true, output: content ?? pc.red("Could not read post-mortem.") };
    }

    case "list": {
      const files = await listPostmortems();
      if (files.length === 0) return { handled: true, output: pc.dim("No post-mortems found.") };
      return { handled: true, output: "Post-mortems:\n" + files.map((f) => `  ${f}`).join("\n") };
    }

    default: {
      const allArgs = action ? [action, ...args] : args;
      const sinceIdx = allArgs.indexOf("--since");
      if (sinceIdx !== -1 && allArgs[sinceIdx + 1]) {
        const daysStr = allArgs[sinceIdx + 1];
        const days = parseInt(daysStr.replace("d", ""), 10) || 7;
        if (!ctx.llmClient) {
          return { handled: true, output: pc.red("LLM client not available for analysis.") };
        }
        const analysis = await analyzePostmortemRange(days, ctx.llmClient);
        return { handled: true, output: analysis ?? pc.red("Could not analyze post-mortems.") };
      }

      if (!ctx.observationSession || !ctx.llmClient || !ctx.messages) {
        return {
          handled: true,
          output: pc.dim("Cannot generate post-mortem: missing session context."),
        };
      }
      const report = await generatePostmortemReport(
        ctx.observationSession.sessionId,
        ctx.messages,
        ctx.observationSession,
        ctx.llmClient,
      );
      if (!report) return { handled: true, output: pc.red("Could not generate post-mortem.") };
      const filePath = await savePostmortem(report);
      return {
        handled: true,
        output: formatPostmortemMarkdown(report) + `\n\n${pc.dim(`Saved \u2192 ${filePath}`)}`,
      };
    }
  }
}
