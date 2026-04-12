import type { TaskDAG, TaskStatus } from "./types.js";

// ── Error ───────────────────────────────────────────────────────────

export class DAGValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DAGValidationError";
  }
}

// ── Validation ──────────────────────────────────────────────────────

export function validateDAG(dag: TaskDAG): void {
  const nodeIds = new Set<string>();

  // Check for duplicate ids
  for (const node of dag.nodes) {
    if (nodeIds.has(node.id)) {
      throw new DAGValidationError(`Duplicate node id: "${node.id}"`);
    }
    nodeIds.add(node.id);
  }

  // Check that all dependencies reference existing nodes
  for (const node of dag.nodes) {
    for (const dep of node.dependencies) {
      if (!nodeIds.has(dep)) {
        throw new DAGValidationError(
          `Node "${node.id}" depends on nonexistent node "${dep}"`,
        );
      }
    }
  }

  // Validate gate references
  for (const gate of dag.gates) {
    for (const id of gate.afterNodes) {
      if (!nodeIds.has(id)) {
        throw new DAGValidationError(
          `Gate "${gate.id}" references nonexistent afterNode "${id}"`,
        );
      }
    }
    for (const id of gate.beforeNodes) {
      if (!nodeIds.has(id)) {
        throw new DAGValidationError(
          `Gate "${gate.id}" references nonexistent beforeNode "${id}"`,
        );
      }
    }
  }

  // Cycle detection via Kahn's algorithm
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const node of dag.nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }

  for (const node of dag.nodes) {
    for (const dep of node.dependencies) {
      adj.get(dep)!.push(node.id);
      inDegree.set(node.id, inDegree.get(node.id)! + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited++;
    for (const neighbor of adj.get(current)!) {
      const newDeg = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (visited !== dag.nodes.length) {
    throw new DAGValidationError(
      "DAG contains a cycle — not all nodes were reachable via topological ordering",
    );
  }
}

// ── Topological Sort (Kahn's) ───────────────────────────────────────

export function topologicalSort(dag: TaskDAG): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const node of dag.nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }

  for (const node of dag.nodes) {
    for (const dep of node.dependencies) {
      adj.get(dep)!.push(node.id);
      inDegree.set(node.id, inDegree.get(node.id)! + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const neighbor of adj.get(current)!) {
      const newDeg = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return result;
}

// ── Ready-Node Resolution ───────────────────────────────────────────

export function getReadyNodes(
  dag: TaskDAG,
  taskStatuses: Map<string, TaskStatus>,
  resolvedGates?: Set<string>,
): string[] {
  // Build set of nodes blocked by unresolved gates
  const gateBlocked = new Set<string>();
  for (const gate of dag.gates) {
    if (resolvedGates?.has(gate.id)) continue;
    // If all afterNodes are completed, the gate is active but unresolved => block beforeNodes
    const allAfterDone = gate.afterNodes.every(
      (id) => taskStatuses.get(id) === "completed",
    );
    if (allAfterDone) {
      for (const id of gate.beforeNodes) {
        gateBlocked.add(id);
      }
    }
  }

  const ready: string[] = [];

  for (const node of dag.nodes) {
    if (taskStatuses.get(node.id) !== "pending") continue;
    if (gateBlocked.has(node.id)) continue;

    const allDepsCompleted = node.dependencies.every(
      (dep) => taskStatuses.get(dep) === "completed",
    );
    if (allDepsCompleted) {
      ready.push(node.id);
    }
  }

  return ready;
}

// ── Dependents ──────────────────────────────────────────────────────

export function getDependents(dag: TaskDAG, nodeId: string): string[] {
  return dag.nodes
    .filter((n) => n.dependencies.includes(nodeId))
    .map((n) => n.id);
}
