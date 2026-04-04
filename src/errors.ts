interface ErrorMapping {
  pattern: RegExp;
  message: string;
}

const ERROR_MAPPINGS: ErrorMapping[] = [
  { pattern: /rate.?limit|429/i, message: "Rate limited. I'll retry automatically." },
  { pattern: /401|unauthorized/i, message: "API key invalid. Run /reset config to fix." },
  { pattern: /403|forbidden/i, message: "API key doesn't have access to this model. Try a different model with --model." },
  { pattern: /fetch failed|network/i, message: "Network error. Check your internet connection." },
  { pattern: /ECONNREFUSED/i, message: "Can't reach the API. Are you behind a proxy or firewall?" },
  { pattern: /context.?length/i, message: "Conversation too long. Use /clear to start fresh or I'll auto-trim." },
  { pattern: /overloaded/i, message: "API is overloaded. Retrying in a moment..." },
  { pattern: /ETIMEDOUT/i, message: "Request timed out. Retrying..." },
];

export function humanizeError(message: string): string {
  for (const mapping of ERROR_MAPPINGS) {
    if (mapping.pattern.test(message)) {
      return mapping.message;
    }
  }
  return message;
}
