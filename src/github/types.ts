import { z } from "zod";

// ---------- Issue ----------
export const GitHubIssueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().nullable().default(null),
  state: z.enum(["OPEN", "CLOSED"]),
  url: z.string().url(),
  labels: z.array(z.object({ name: z.string() })).default([]),
  assignees: z.array(z.object({ login: z.string() })).default([]),
  author: z.object({ login: z.string() }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GitHubIssue = z.infer<typeof GitHubIssueSchema>;

// ---------- Pull Request ----------
export const GitHubPRSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().nullable().default(null),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  url: z.string().url(),
  headRefName: z.string(),
  baseRefName: z.string(),
  isDraft: z.boolean().default(false),
  mergeable: z
    .enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"])
    .default("UNKNOWN"),
  labels: z.array(z.object({ name: z.string() })).default([]),
  author: z.object({ login: z.string() }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GitHubPR = z.infer<typeof GitHubPRSchema>;

// ---------- Workflow Run (CI) ----------
export const WorkflowRunSchema = z.object({
  databaseId: z.number().int().positive(),
  name: z.string(),
  workflowName: z.string().optional(),
  status: z.enum([
    "queued",
    "in_progress",
    "completed",
    "waiting",
    "requested",
    "pending",
  ]),
  conclusion: z
    .enum([
      "success",
      "failure",
      "cancelled",
      "skipped",
      "timed_out",
      "action_required",
      "neutral",
      "stale",
      "",
    ])
    .nullable()
    .default(null),
  url: z.string().url(),
  headBranch: z.string(),
  event: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

// ---------- Check Status (simplified) ----------
export const CheckStatusSchema = z.object({
  passed: z.boolean(),
  pending: z.boolean(),
  failing: z.boolean(),
  total: z.number().int().nonnegative(),
  details: z
    .array(
      z.object({
        name: z.string(),
        status: z.string(),
        conclusion: z.string().nullable(),
      }),
    )
    .default([]),
});
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

// ---------- gh CLI result wrapper ----------
export const GhResultSchema = z.object({
  success: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int(),
});
export type GhResult = z.infer<typeof GhResultSchema>;
