import pc from "picocolors";

interface Reminder {
  message: string;
  dueAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

const activeReminders: Reminder[] = [];

export function parseTime(timeStr: string): number | null {
  const match = timeStr.match(/^(\d+)(m|h)$/);
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2];
    return unit === "m" ? value * 60 * 1000 : value * 60 * 60 * 1000;
  }
  if (timeStr === "tomorrow") return 24 * 60 * 60 * 1000;
  return null;
}

export function setReminder(timeStr: string, message: string): string | null {
  const ms = parseTime(timeStr);
  if (!ms) return null;

  const reminder: Reminder = {
    message,
    dueAt: Date.now() + ms,
  };

  reminder.timer = setTimeout(() => {
    console.log(`\n${pc.yellow("\u23f0")} ${pc.bold("Reminder:")} ${message}`);
    const idx = activeReminders.indexOf(reminder);
    if (idx >= 0) activeReminders.splice(idx, 1);
  }, ms);

  activeReminders.push(reminder);

  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minutes`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours > 1 ? "s" : ""}`;
}

export function clearReminders(): void {
  for (const r of activeReminders) {
    if (r.timer) clearTimeout(r.timer);
  }
  activeReminders.length = 0;
}

export function getActiveCount(): number {
  return activeReminders.length;
}
