/**
 * TaskFlow Pro - DAG Engine (Directed Acyclic Graph)
 * 
 * Core engine handling:
 * 1. Cycle Detection (DFS path finding & verification)
 * 2. Blocked / Ready Status Computation with downstream cascading
 * 3. No-Compounding Schedule Propagation (PERT/CPM max-slack topological propagation)
 * 4. Status Regression & Rollback Handling
 * 5. Critical Path Method (CPM) calculation
 */

// Helper: Format Date to YYYY-MM-DD
export function formatDate(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

// Helper: Add days to a YYYY-MM-DD string or Date object
export function addDays(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// Helper: Calculate difference in days between two YYYY-MM-DD dates (d2 - d1)
export function diffDays(d1, d2) {
  if (!d1 || !d2) return 0;
  const t1 = new Date(d1).getTime();
  const t2 = new Date(d2).getTime();
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

/**
 * ----------------------------------------------------------------------
 * 1. CYCLE DETECTION
 * ----------------------------------------------------------------------
 * Graph representation:
 * - Edges: { task_id (downstream), depends_on_task_id (upstream prerequisite) }
 * Meaning: depends_on_task_id -> task_id (dependency flow)
 * 
 * Adding an edge: `taskId` depends on `dependsOnTaskId`
 * Creates a directed edge: dependsOnTaskId -> taskId
 * 
 * A cycle occurs if there is ALREADY a path from taskId to dependsOnTaskId.
 */
export function detectCycle(tasks, existingDependencies, newEdge) {
  const { task_id, depends_on_task_id } = newEdge;

  // Immediate self-loop check
  if (task_id === depends_on_task_id) {
    const task = tasks.find(t => t.id === task_id);
    const name = task ? task.title : task_id;
    return {
      hasCycle: true,
      cyclePath: [name, name],
      message: `Cannot add dependency: task "${name}" cannot depend on itself.`
    };
  }

  // Build adjacency list for graph: prerequisite -> array of dependent tasks
  // When task A is prerequisite of task B, directed edge is A -> B
  const adj = new Map();
  const taskMap = new Map();

  for (const t of tasks) {
    adj.set(t.id, []);
    taskMap.set(t.id, t.title || t.id);
  }

  // Populate existing edges
  for (const dep of existingDependencies) {
    if (adj.has(dep.depends_on_task_id)) {
      adj.get(dep.depends_on_task_id).push(dep.task_id);
    }
  }

  // Add proposed edge: depends_on_task_id -> task_id
  if (!adj.has(depends_on_task_id)) adj.set(depends_on_task_id, []);
  adj.get(depends_on_task_id).push(task_id);

  // Run DFS from task_id to check if we can reach depends_on_task_id
  // If we can reach depends_on_task_id starting from task_id, adding (depends_on_task_id -> task_id) closes a loop!
  const visited = new Set();
  const recursionStack = [];

  function dfs(currentId, targetId) {
    visited.add(currentId);
    recursionStack.push(currentId);

    if (currentId === targetId) {
      return true;
    }

    const neighbors = adj.get(currentId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor, targetId)) return true;
      } else if (recursionStack.includes(neighbor) && neighbor === targetId) {
        recursionStack.push(neighbor);
        return true;
      }
    }

    recursionStack.pop();
    return false;
  }

  // Search for path from task_id to depends_on_task_id
  const hasPath = dfs(task_id, depends_on_task_id);

  if (hasPath) {
    // Construct full cycle path representation
    // Path found from task_id -> ... -> depends_on_task_id
    // Closing edge is depends_on_task_id -> task_id
    const pathIds = [depends_on_task_id, ...recursionStack];
    const pathTitles = pathIds.map(id => taskMap.get(id) || id);
    const pathStr = pathTitles.join(' → ');

    return {
      hasCycle: true,
      cyclePath: pathTitles,
      message: `Cannot add dependency: would create a cycle ${pathStr}`
    };
  }

  return { hasCycle: false };
}

/**
 * ----------------------------------------------------------------------
 * 2. BLOCKED / READY STATUS COMPUTATION
 * ----------------------------------------------------------------------
 * Rule:
 * - A task is 'blocked' if ANY direct prerequisite has column_status != 'done'.
 * - A task is 'ready' if ALL direct prerequisites have column_status == 'done' (or no prerequisites).
 */
export function computeTaskDependencyStatus(taskId, tasks, dependencies) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return 'ready';

  // Find all direct prerequisites (tasks that this task depends on)
  const prereqIds = dependencies
    .filter(d => d.task_id === taskId)
    .map(d => d.depends_on_task_id);

  if (prereqIds.length === 0) {
    return 'ready';
  }

  // Check status of each prerequisite
  const allPrereqsDone = prereqIds.every(prereqId => {
    const prereq = tasks.find(t => t.id === prereqId);
    return prereq && prereq.column_status === 'done';
  });

  return allPrereqsDone ? 'ready' : 'blocked';
}

/**
 * Cascade status recalculation across the entire graph or downstream from modified tasks.
 * Returns an array of tasks that had their dependency_status changed.
 */
export function recomputeGraphDependencyStatuses(tasks, dependencies) {
  const taskMap = new Map(tasks.map(t => [t.id, { ...t }]));
  const updatedTasks = [];

  // Topologically or iteratively recompute until convergence
  let changed = true;
  let iterations = 0;
  const maxIterations = tasks.length * 2 + 10;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (const task of taskMap.values()) {
      const currentStatus = task.dependency_status;
      const computedStatus = computeTaskDependencyStatus(task.id, Array.from(taskMap.values()), dependencies);

      if (currentStatus !== computedStatus) {
        task.dependency_status = computedStatus;
        changed = true;
      }
    }
  }

  // Collect updated tasks
  for (const task of taskMap.values()) {
    const original = tasks.find(t => t.id === task.id);
    if (original && original.dependency_status !== task.dependency_status) {
      updatedTasks.push({
        id: task.id,
        old_dependency_status: original.dependency_status,
        new_dependency_status: task.dependency_status
      });
    }
  }

  return {
    tasks: Array.from(taskMap.values()),
    updatedTasks
  };
}

/**
 * ----------------------------------------------------------------------
 * 3. NO-COMPOUNDING SCHEDULE PROPAGATION
 * ----------------------------------------------------------------------
 * When an upstream task's end_date changes:
 * 1. Find all downstream descendants in topological order.
 * 2. For each descendant D:
 *    new_start_date(D) = max(current_start_date(D), max over all direct prereqs P of (new_end_date(P) + 1 day))
 *    new_end_date(D) = new_start_date(D) + duration - 1 day (or duration)
 * 3. Guarantees diamond convergence (A->B->D, A->C->D) propagates the upstream delay ONCE, not additively.
 */
export function propagateSchedule({
  changedTaskId,
  newStartDate,
  newEndDate,
  tasks,
  dependencies,
  bufferDays = 1 // 1 day gap between prerequisite completion and dependent start
}) {
  const taskMap = new Map(tasks.map(t => [t.id, { ...t }]));
  const auditLogs = [];

  const targetTask = taskMap.get(changedTaskId);
  if (!targetTask) return { tasks: Array.from(taskMap.values()), auditLogs };

  const oldTargetEndDate = targetTask.end_date;
  const oldTargetStartDate = targetTask.start_date;

  // Update target task dates
  if (newStartDate) targetTask.start_date = formatDate(newStartDate);
  if (newEndDate) targetTask.end_date = formatDate(newEndDate);

  if (targetTask.start_date && targetTask.end_date) {
    const dur = diffDays(targetTask.start_date, targetTask.end_date) + 1;
    targetTask.base_duration_days = Math.max(1, dur);
  }

  // Build adjacency list: prerequisite -> [dependents]
  const downstreamAdj = new Map();
  const inDegree = new Map();

  for (const t of tasks) {
    downstreamAdj.set(t.id, []);
    inDegree.set(t.id, 0);
  }

  for (const dep of dependencies) {
    if (downstreamAdj.has(dep.depends_on_task_id)) {
      downstreamAdj.get(dep.depends_on_task_id).push(dep.task_id);
      inDegree.set(dep.task_id, (inDegree.get(dep.task_id) || 0) + 1);
    }
  }

  // Collect all descendants of changedTaskId using BFS/DFS
  const descendants = new Set();
  const queue = [changedTaskId];
  while (queue.length > 0) {
    const curr = queue.shift();
    const children = downstreamAdj.get(curr) || [];
    for (const childId of children) {
      if (!descendants.has(childId)) {
        descendants.add(childId);
        queue.push(childId);
      }
    }
  }

  if (descendants.size === 0) {
    // No downstream tasks to shift
    return {
      tasks: Array.from(taskMap.values()),
      auditLogs
    };
  }

  // Topological sorting of descendants
  // Compute in-degrees considering only relevant edges
  const subInDegree = new Map();
  for (const dId of descendants) {
    subInDegree.set(dId, 0);
  }

  for (const dep of dependencies) {
    if (descendants.has(dep.task_id) && (descendants.has(dep.depends_on_task_id) || dep.depends_on_task_id === changedTaskId)) {
      subInDegree.set(dep.task_id, (subInDegree.get(dep.task_id) || 0) + 1);
    }
  }

  const topoQueue = [];
  for (const dId of descendants) {
    // Tasks with 0 in-degree among the subgraph of descendants
    const directPrereqs = dependencies.filter(d => d.task_id === dId).map(d => d.depends_on_task_id);
    const hasUnprocessedPrereqInDescendants = directPrereqs.some(pId => descendants.has(pId));
    if (!hasUnprocessedPrereqInDescendants) {
      topoQueue.push(dId);
    }
  }

  const topoOrder = [];
  const processed = new Set();

  while (topoQueue.length > 0) {
    const currId = topoQueue.shift();
    topoOrder.push(currId);
    processed.add(currId);

    const children = downstreamAdj.get(currId) || [];
    for (const childId of children) {
      if (descendants.has(childId)) {
        // Check if all prerequisite descendants of childId are processed
        const childPrereqs = dependencies.filter(d => d.task_id === childId).map(d => d.depends_on_task_id);
        const allPrereqsProcessed = childPrereqs.every(pId => !descendants.has(pId) || processed.has(pId));
        if (allPrereqsProcessed && !processed.has(childId) && !topoQueue.includes(childId)) {
          topoQueue.push(childId);
        }
      }
    }
  }

  // Fallback if topoOrder is missing any descendants due to non-descendant dependencies
  for (const dId of descendants) {
    if (!topoOrder.includes(dId)) {
      topoOrder.push(dId);
    }
  }

  // Process nodes in topological order (No-Compounding CPM propagation)
  for (const taskId of topoOrder) {
    const task = taskMap.get(taskId);
    if (!task) continue;

    // Find all direct prerequisites of this task
    const prereqDeps = dependencies.filter(d => d.task_id === taskId);
    if (prereqDeps.length === 0) continue;

    // Determine the latest end date among all prerequisites
    let latestPrereqEndDate = null;

    for (const dep of prereqDeps) {
      const prereq = taskMap.get(dep.depends_on_task_id);
      if (prereq && prereq.end_date) {
        if (!latestPrereqEndDate || new Date(prereq.end_date) > new Date(latestPrereqEndDate)) {
          latestPrereqEndDate = prereq.end_date;
        }
      }
    }

    if (!latestPrereqEndDate) continue;

    // Earliest possible start date based on prerequisites
    // Earliest start = latestPrereqEndDate + bufferDays (e.g. next day)
    const earliestStartDate = addDays(latestPrereqEndDate, bufferDays);
    const originalStartDate = task.start_date;
    const originalEndDate = task.end_date;
    const duration = task.base_duration_days || Math.max(1, diffDays(originalStartDate, originalEndDate) + 1);

    // If current start date is earlier than earliest possible start date, shift task
    if (!originalStartDate || new Date(originalStartDate) < new Date(earliestStartDate)) {
      const newDescStartDate = earliestStartDate;
      const newDescEndDate = addDays(newDescStartDate, duration - 1);

      task.start_date = newDescStartDate;
      task.end_date = newDescEndDate;
      task.base_duration_days = duration;

      auditLogs.push({
        task_id: task.id,
        task_title: task.title,
        old_start_date: originalStartDate,
        new_start_date: newDescStartDate,
        old_end_date: originalEndDate,
        new_end_date: newDescEndDate,
        triggered_by_task_id: changedTaskId,
        action: 'schedule_propagation',
        details: JSON.stringify({
          reason: `Shifted to respect latest prerequisite finish (${latestPrereqEndDate})`,
          delta_days: diffDays(originalEndDate || originalStartDate, newDescEndDate)
        })
      });
    }
  }

  return {
    tasks: Array.from(taskMap.values()),
    auditLogs
  };
}

/**
 * ----------------------------------------------------------------------
 * 4. CRITICAL PATH METHOD (CPM)
 * ----------------------------------------------------------------------
 * Identifies the longest dependency path (by cumulative duration / span)
 */
export function calculateCriticalPath(tasks, dependencies) {
  if (!tasks || tasks.length === 0) {
    return { criticalPathTaskIds: [], totalDurationDays: 0, criticalPaths: [] };
  }

  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const adj = new Map();
  const inDegree = new Map();

  for (const t of tasks) {
    adj.set(t.id, []);
    inDegree.set(t.id, 0);
  }

  for (const dep of dependencies) {
    if (adj.has(dep.depends_on_task_id)) {
      adj.get(dep.depends_on_task_id).push(dep.task_id);
      inDegree.set(dep.task_id, (inDegree.get(dep.task_id) || 0) + 1);
    }
  }

  // Find all paths using DFS from source nodes (inDegree === 0)
  const sourceNodes = tasks.filter(t => (inDegree.get(t.id) || 0) === 0);
  let maxWeight = -1;
  let criticalPath = [];

  function dfsPath(currId, currentPath, currentWeight) {
    const task = taskMap.get(currId);
    const duration = task ? (task.base_duration_days || 1) : 1;
    const newWeight = currentWeight + duration;
    const newPath = [...currentPath, currId];

    const neighbors = adj.get(currId) || [];
    if (neighbors.length === 0) {
      if (newWeight > maxWeight) {
        maxWeight = newWeight;
        criticalPath = newPath;
      }
      return;
    }

    for (const neighbor of neighbors) {
      dfsPath(neighbor, newPath, newWeight);
    }
  }

  for (const source of sourceNodes) {
    dfsPath(source.id, [], 0);
  }

  return {
    criticalPathTaskIds: criticalPath,
    totalDurationDays: Math.max(0, maxWeight),
    criticalPathTasks: criticalPath.map(id => taskMap.get(id)).filter(Boolean)
  };
}

export default {
  detectCycle,
  computeTaskDependencyStatus,
  recomputeGraphDependencyStatuses,
  propagateSchedule,
  calculateCriticalPath,
  formatDate,
  addDays,
  diffDays
};
