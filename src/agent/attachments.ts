import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import type { ImageBlock } from "../llm/types.js";
import type { McpManager } from "../mcp/client.js";

const TEXT_EXTS = new Set([
  ".txt", ".md", ".json", ".js", ".ts", ".jsx", ".tsx", ".py",
  ".html", ".css", ".yml", ".yaml", ".toml", ".xml", ".csv",
  ".sh", ".bash", ".zsh", ".env", ".cfg", ".ini", ".log",
  ".sql", ".graphql", ".rs", ".go", ".java", ".rb", ".php",
  ".c", ".cpp", ".h", ".swift", ".kt", ".r", ".lua",
]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const DOC_EXTS = new Set([".docx", ".doc", ".pdf", ".pptx", ".ppt", ".xlsx", ".xls", ".odt", ".rtf", ".epub"]);

const MIME_MAP: Record<string, ImageBlock["source"]["media_type"]> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/png",
};

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB

export interface ParsedAttachments {
  textContent: string;
  imageBlocks: ImageBlock[];
}

/**
 * Scan user input for local file paths and image URLs, attach the readable
 * ones to the outgoing message. Text files get inlined as <file> XML blocks,
 * images become ImageBlock[], and binary documents are converted via MCP's
 * doc_convert tool when available.
 *
 * Progress messages are written to stdout directly — this function is meant
 * to run inside the interactive agent loop, not as a pure transformation.
 */
export async function parseAttachments(
  input: string,
  mcpManager?: McpManager,
): Promise<ParsedAttachments> {
  let textContent = input;
  const imageBlocks: ImageBlock[] = [];

  // Local file paths
  const filePathMatches = [...input.matchAll(/(\/[\w./-]+|~\/[\w./-]+)/g)];
  for (const match of filePathMatches) {
    let filePath = match[1];
    if (filePath.startsWith("~/")) {
      filePath = path.join(os.homedir(), filePath.slice(2));
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;

    const ext = path.extname(filePath).toLowerCase();

    if (IMAGE_EXTS.has(ext)) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_IMAGE_BYTES) {
          process.stdout.write(pc.yellow(`  [skipped: ${path.basename(filePath)} \u2014 exceeds 20MB limit]\n`));
          continue;
        }
        const data = fs.readFileSync(filePath).toString("base64");
        const mediaType = MIME_MAP[ext] || "image/png";
        imageBlocks.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data },
        });
        process.stdout.write(pc.dim(`  [attached image: ${path.basename(filePath)} (${(stat.size / 1024).toFixed(1)}KB)]\n`));
      } catch {
        process.stdout.write(pc.dim(`  [could not read image: ${filePath}]\n`));
      }
    } else if (TEXT_EXTS.has(ext) || ext === "") {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const maxChars = 50000;
        const trimmed = content.length > maxChars
          ? content.slice(0, maxChars) + `\n\n[... truncated, ${content.length - maxChars} chars remaining]`
          : content;
        textContent += `\n\n<file path="${filePath}" size="${content.length} chars">\n${trimmed}\n</file>`;
        process.stdout.write(pc.dim(`  [attached: ${path.basename(filePath)} (${(content.length / 1024).toFixed(1)}KB)]\n`));
      } catch {
        process.stdout.write(pc.dim(`  [could not read: ${filePath}]\n`));
      }
    } else if (DOC_EXTS.has(ext)) {
      if (mcpManager) {
        try {
          process.stdout.write(pc.dim(`  [converting: ${path.basename(filePath)}...]\n`));
          const converted = await mcpManager.callTool("doc_convert", { path: filePath });
          if (converted && !converted.startsWith("Error") && !converted.includes("Could not convert")) {
            textContent += `\n\n<file path="${filePath}" format="${ext}">\n${converted.slice(0, 50000)}\n</file>`;
            process.stdout.write(pc.dim(`  [attached: ${path.basename(filePath)} (converted from ${ext})]\n`));
          } else {
            textContent += `\n\n<file-error path="${filePath}">\n${converted}\n</file-error>`;
            process.stdout.write(pc.yellow(`  [conversion note: ${converted.split("\n")[0]}]\n`));
          }
        } catch {
          process.stdout.write(pc.dim(`  [could not convert: ${path.basename(filePath)}]\n`));
        }
      } else {
        process.stdout.write(pc.yellow(`  Binary file (${ext}) \u2014 install Docling for document support: pip install docling\n`));
      }
    }
  }

  // Image URLs
  const urlImageMatches = [...input.matchAll(/https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)(?:\?\S*)?/gi)];
  for (const match of urlImageMatches) {
    const url = match[0];
    try {
      process.stdout.write(pc.dim(`  [fetching image: ${url.slice(0, 60)}...]\n`));
      const response = await fetch(url);
      if (!response.ok) {
        process.stdout.write(pc.yellow(`  [could not fetch: HTTP ${response.status}]\n`));
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_IMAGE_BYTES) {
        process.stdout.write(pc.yellow(`  [skipped: image URL exceeds 20MB limit]\n`));
        continue;
      }
      const contentType = response.headers.get("content-type") || "";
      let mediaType: ImageBlock["source"]["media_type"] = "image/png";
      if (contentType.includes("jpeg") || contentType.includes("jpg")) mediaType = "image/jpeg";
      else if (contentType.includes("gif")) mediaType = "image/gif";
      else if (contentType.includes("webp")) mediaType = "image/webp";
      else if (contentType.includes("png")) mediaType = "image/png";

      imageBlocks.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") },
      });
      process.stdout.write(pc.dim(`  [attached image URL: (${(buffer.length / 1024).toFixed(1)}KB)]\n`));
    } catch {
      process.stdout.write(pc.dim(`  [could not fetch image: ${url}]\n`));
    }
  }

  return { textContent, imageBlocks };
}
