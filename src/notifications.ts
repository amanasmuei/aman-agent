import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import { getDueTasks } from "./scheduler.js";

export interface Notification {
  type: "schedule" | "eval" | "health";
  message: string;
}

export function checkNotifications(): Notification[] {
  const notifications: Notification[] = [];

  // Check due scheduled tasks
  const dueTasks = getDueTasks();
  for (const task of dueTasks) {
    notifications.push({
      type: "schedule",
      message: `${task.name} (${task.schedule})`,
    });
  }

  // Check aeval — sessions not logged recently
  const evalPath = path.join(os.homedir(), ".aeval", "eval.md");
  if (fs.existsSync(evalPath)) {
    const content = fs.readFileSync(evalPath, "utf-8");
    const dateMatch = content.match(/- Last updated: (.+)$/m);
    if (dateMatch) {
      const lastDate = new Date(dateMatch[1]);
      const daysSince =
        (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 3) {
        notifications.push({
          type: "eval",
          message: `No session logged in ${Math.floor(daysSince)} days \u2014 run /eval to log one`,
        });
      }
    }
  }

  return notifications;
}

export function displayNotifications(notifications: Notification[]): void {
  if (notifications.length === 0) return;

  console.log(
    pc.yellow(
      `\n\u26a0 ${notifications.length} notification${notifications.length > 1 ? "s" : ""}:`,
    ),
  );
  for (const n of notifications) {
    console.log(`  - ${n.message}`);
  }
  console.log("");
}
