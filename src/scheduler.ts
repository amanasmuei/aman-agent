import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SCHEDULES_PATH = path.join(os.homedir(), ".aman-agent", "schedules.json");

export interface ScheduledTask {
  id: string;
  name: string;
  schedule: string;
  action: string;
  mode: "notify" | "auto-run";
  createdAt: string;
  lastRun?: string;
}

export function loadSchedules(): ScheduledTask[] {
  if (!fs.existsSync(SCHEDULES_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(SCHEDULES_PATH, "utf-8"));
  } catch {
    return [];
  }
}

export function saveSchedules(tasks: ScheduledTask[]): void {
  const dir = path.dirname(SCHEDULES_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    SCHEDULES_PATH,
    JSON.stringify(tasks, null, 2) + "\n",
    "utf-8",
  );
}

export function addSchedule(
  task: Omit<ScheduledTask, "id" | "createdAt">,
): ScheduledTask {
  const tasks = loadSchedules();
  const newTask: ScheduledTask = {
    ...task,
    id: Date.now().toString(36),
    createdAt: new Date().toISOString(),
  };
  tasks.push(newTask);
  saveSchedules(tasks);
  return newTask;
}

export function removeSchedule(id: string): boolean {
  const tasks = loadSchedules();
  const filtered = tasks.filter((t) => t.id !== id);
  if (filtered.length === tasks.length) return false;
  saveSchedules(filtered);
  return true;
}

export function getDueTasks(): ScheduledTask[] {
  const tasks = loadSchedules();
  const now = new Date();
  return tasks.filter((task) => {
    if (!task.lastRun) return true;
    const lastRun = new Date(task.lastRun);
    return isDue(task.schedule, lastRun, now);
  });
}

export function isDue(schedule: string, lastRun: Date, now: Date): boolean {
  const hoursSinceLastRun =
    (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60);

  if (schedule.startsWith("every ")) {
    const match = schedule.match(/every (\d+)h/);
    if (match) return hoursSinceLastRun >= parseInt(match[1]);
  }
  if (schedule === "daily" || schedule.startsWith("daily ")) {
    return hoursSinceLastRun >= 20;
  }
  if (schedule === "weekdays" || schedule.startsWith("weekdays ")) {
    const day = now.getDay();
    return day >= 1 && day <= 5 && hoursSinceLastRun >= 20;
  }
  if (schedule.startsWith("weekly")) {
    return hoursSinceLastRun >= 144;
  }
  return false;
}

export function markRun(id: string): void {
  const tasks = loadSchedules();
  const task = tasks.find((t) => t.id === id);
  if (task) {
    task.lastRun = new Date().toISOString();
    saveSchedules(tasks);
  }
}
