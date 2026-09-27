import {
  detectCycle,
  computeTaskDependencyStatus,
  recomputeGraphDependencyStatuses,
  propagateSchedule,
  calculateCriticalPath,
  formatDate,
  addDays,
  diffDays
} from '../engine/dagEngine.js';

describe('DAG Engine - Directed Acyclic Graph Logic', () => {

  describe('3.1 Cycle Detection', () => {
    test('detects and rejects a direct self-loop (A -> A)', () => {
      const tasks = [{ id: 'task-A', title: 'Task A' }];
      const existingDependencies = [];
      const newEdge = { task_id: 'task-A', depends_on_task_id: 'task-A' };

      const result = detectCycle(tasks, existingDependencies, newEdge);
      expect(result.hasCycle).toBe(true);
      expect(result.message).toContain('cannot depend on itself');
    });

    test('detects and rejects a 2-node cycle (A -> B -> A)', () => {
      const tasks = [
        { id: 'task-A', title: 'Task A' },
        { id: 'task-B', title: 'Task B' }
      ];
      // Existing: B depends on A (A -> B)
      const existingDependencies = [
        { id: 'dep-1', task_id: 'task-B', depends_on_task_id: 'task-A' }
      ];
      // Proposed: A depends on B (B -> A) => Cycle!
      const newEdge = { task_id: 'task-A', depends_on_task_id: 'task-B' };

      const result = detectCycle(tasks, existingDependencies, newEdge);
      expect(result.hasCycle).toBe(true);
      expect(result.message).toContain('would create a cycle');
      expect(result.cyclePath).toEqual(['Task B', 'Task A', 'Task B']);
    });

    test('detects and rejects a 3-node cycle (A -> B -> C -> A)', () => {
      const tasks = [
        { id: 'task-A', title: 'Task A' },
        { id: 'task-B', title: 'Task B' },
        { id: 'task-C', title: 'Task C' }
      ];
      // Existing: B depends on A, C depends on B
      const existingDependencies = [
        { id: 'dep-1', task_id: 'task-B', depends_on_task_id: 'task-A' },
        { id: 'dep-2', task_id: 'task-C', depends_on_task_id: 'task-B' }
      ];
      // Proposed: A depends on C (C -> A) => Cycle!
      const newEdge = { task_id: 'task-A', depends_on_task_id: 'task-C' };

      const result = detectCycle(tasks, existingDependencies, newEdge);
      expect(result.hasCycle).toBe(true);
      expect(result.message).toContain('would create a cycle');
      expect(result.cyclePath).toEqual(['Task C', 'Task A', 'Task B', 'Task C']);
    });

    test('allows valid DAG edge addition without cycles', () => {
      const tasks = [
        { id: 'task-A', title: 'Task A' },
        { id: 'task-B', title: 'Task B' },
        { id: 'task-C', title: 'Task C' }
      ];
      // Existing: B depends on A
      const existingDependencies = [
        { id: 'dep-1', task_id: 'task-B', depends_on_task_id: 'task-A' }
      ];
      // Proposed: C depends on B (valid chain A -> B -> C)
      const newEdge = { task_id: 'task-C', depends_on_task_id: 'task-B' };

      const result = detectCycle(tasks, existingDependencies, newEdge);
      expect(result.hasCycle).toBe(false);
    });
  });

  describe('3.2 Blocked / Ready Status Computation', () => {
    test('task with no prerequisites is ready', () => {
      const tasks = [{ id: 'task-A', title: 'Task A', column_status: 'backlog', dependency_status: 'ready' }];
      const dependencies = [];

      const status = computeTaskDependencyStatus('task-A', tasks, dependencies);
      expect(status).toBe('ready');
    });

    test('task is blocked if any prerequisite is not done', () => {
      const tasks = [
        { id: 'task-A', title: 'Task A', column_status: 'in_progress', dependency_status: 'ready' },
        { id: 'task-B', title: 'Task B', column_status: 'backlog', dependency_status: 'blocked' }
      ];
      // B depends on A
      const dependencies = [{ id: 'dep-1', task_id: 'task-B', depends_on_task_id: 'task-A' }];

      const status = computeTaskDependencyStatus('task-B', tasks, dependencies);
      expect(status).toBe('blocked');
    });

    test('task transitions to ready when all prerequisites are done', () => {
      const tasks = [
        { id: 'task-A', title: 'Task A', column_status: 'done', dependency_status: 'ready' },
        { id: 'task-B', title: 'Task B', column_status: 'done', dependency_status: 'ready' },
        { id: 'task-C', title: 'Task C', column_status: 'backlog', dependency_status: 'blocked' }
      ];
      // C depends on A and B
      const dependencies = [
        { id: 'dep-1', task_id: 'task-C', depends_on_task_id: 'task-A' },
        { id: 'dep-2', task_id: 'task-C', depends_on_task_id: 'task-B' }
      ];

      const status = computeTaskDependencyStatus('task-C', tasks, dependencies);
      expect(status).toBe('ready');
    });

    test('cascades downstream when upstream prerequisite completes', () => {
      const tasks = [
        { id: 'task-A', title: 'Task A', column_status: 'done', dependency_status: 'ready' },
        { id: 'task-B', title: 'Task B', column_status: 'backlog', dependency_status: 'blocked' },
        { id: 'task-C', title: 'Task C', column_status: 'backlog', dependency_status: 'blocked' }
      ];
      // B depends on A, C depends on B
      const dependencies = [
        { id: 'dep-1', task_id: 'task-B', depends_on_task_id: 'task-A' },
        { id: 'dep-2', task_id: 'task-C', depends_on_task_id: 'task-B' }
      ];

      const { tasks: updatedTasks, updatedTasks: changedList } = recomputeGraphDependencyStatuses(tasks, dependencies);
      
      const taskB = updatedTasks.find(t => t.id === 'task-B');
      const taskC = updatedTasks.find(t => t.id === 'task-C');

      // Task B should now be ready because A is done
      expect(taskB.dependency_status).toBe('ready');
      // Task C remains blocked because B is still backlog (not done)
      expect(taskC.dependency_status).toBe('blocked');
      expect(changedList).toEqual([
        { id: 'task-B', old_dependency_status: 'blocked', new_dependency_status: 'ready' }
      ]);
    });

    test('3-level chain: completing A does not unblock C until B is also done', () => {
      // 3-level chain: A -> B -> C
      let currentTasks = [
        { id: 'A', title: 'Task A', column_status: 'in_progress', dependency_status: 'ready' },
        { id: 'B', title: 'Task B', column_status: 'backlog', dependency_status: 'blocked' },
        { id: 'C', title: 'Task C', column_status: 'backlog', dependency_status: 'blocked' }
      ];
      const dependencies = [
        { id: 'd1', task_id: 'B', depends_on_task_id: 'A' },
        { id: 'd2', task_id: 'C', depends_on_task_id: 'B' }
      ];

      // Step 1: Complete A
      currentTasks[0].column_status = 'done';
      let pass1 = recomputeGraphDependencyStatuses(currentTasks, dependencies);
      
      let taskB = pass1.tasks.find(t => t.id === 'B');
      let taskC = pass1.tasks.find(t => t.id === 'C');
      expect(taskB.dependency_status).toBe('ready');
      expect(taskC.dependency_status).toBe('blocked'); // C MUST remain blocked!

      // Step 2: Complete B
      pass1.tasks.find(t => t.id === 'B').column_status = 'done';
      let pass2 = recomputeGraphDependencyStatuses(pass1.tasks, dependencies);
      taskC = pass2.tasks.find(t => t.id === 'C');
      expect(taskC.dependency_status).toBe('ready'); // Now C unblocks!
    });
  });

  describe('3.3 No-Compounding Schedule Propagation (Diamond Convergence & Deep Multi-Level Tests)', () => {
    test('propagates delay through diamond graph without compounding delay additively', () => {
      /**
       * Diamond Graph Scenario:
       *        Task A (Day 1 - Day 5, dur 5)
       *       /      \
       *  Task B      Task C
       *  (Day 6-8,   (Day 6-10,
       *   dur 3)      dur 5)
       *       \      /
       *        Task D (Day 11 - Day 12, dur 2)
       * 
       * Trigger: Task A is extended by +3 days:
       * A new end date = Day 8 (2026-10-08)
       * 
       * Expected propagation:
       * - Task B: starts Day 9, ends Day 11 (shifted +3 days)
       * - Task C: starts Day 9, ends Day 13 (shifted +3 days)
       * - Task D: prerequisite B ends Day 11, prerequisite C ends Day 13.
       *   D start = max(Day 12, Day 14) = Day 14
       *   D end = Day 14 + 2 - 1 = Day 15 (2026-10-15)
       * 
       * Verification:
       * D shifted from Day 12 to Day 15 (+3 days total delay).
       * It must NOT compound to +6 days!
       */
      const initialTasks = [
        { id: 'A', title: 'Design Schema', start_date: '2026-10-01', end_date: '2026-10-05', base_duration_days: 5 },
        { id: 'B', title: 'Build Backend API', start_date: '2026-10-06', end_date: '2026-10-08', base_duration_days: 3 },
        { id: 'C', title: 'Build UI Components', start_date: '2026-10-06', end_date: '2026-10-10', base_duration_days: 5 },
        { id: 'D', title: 'End-to-End Demo', start_date: '2026-10-11', end_date: '2026-10-12', base_duration_days: 2 }
      ];

      const dependencies = [
        { id: 'd1', task_id: 'B', depends_on_task_id: 'A' },
        { id: 'd2', task_id: 'C', depends_on_task_id: 'A' },
        { id: 'd3', task_id: 'D', depends_on_task_id: 'B' },
        { id: 'd4', task_id: 'D', depends_on_task_id: 'C' }
      ];

      // Shift Task A by +3 days (from 2026-10-05 to 2026-10-08)
      const { tasks: propagatedTasks, auditLogs } = propagateSchedule({
        changedTaskId: 'A',
        newStartDate: '2026-10-01',
        newEndDate: '2026-10-08',
        tasks: initialTasks,
        dependencies,
        bufferDays: 1
      });

      const taskA = propagatedTasks.find(t => t.id === 'A');
      const taskB = propagatedTasks.find(t => t.id === 'B');
      const taskC = propagatedTasks.find(t => t.id === 'C');
      const taskD = propagatedTasks.find(t => t.id === 'D');

      expect(taskA.end_date).toBe('2026-10-08');

      // Task B: starts 2026-10-09, ends 2026-10-11 (dur 3)
      expect(taskB.start_date).toBe('2026-10-09');
      expect(taskB.end_date).toBe('2026-10-11');

      // Task C: starts 2026-10-09, ends 2026-10-13 (dur 5)
      expect(taskC.start_date).toBe('2026-10-09');
      expect(taskC.end_date).toBe('2026-10-13');

      // Task D: earliest start is max(B.end+1, C.end+1) = max(10-12, 10-14) = 2026-10-14
      // Task D: ends 2026-10-15 (dur 2)
      expect(taskD.start_date).toBe('2026-10-14');
      expect(taskD.end_date).toBe('2026-10-15');

      // Check audit log entries were created for downstream affected tasks
      expect(auditLogs.length).toBe(3); // B, C, and D
      expect(auditLogs.map(l => l.task_id)).toEqual(['B', 'C', 'D']);
    });

    test('deep multi-level propagation (A -> B -> D -> F and A -> C -> D -> F)', () => {
      const initialTasks = [
        { id: 'A', title: 'Task A', start_date: '2026-10-01', end_date: '2026-10-03', base_duration_days: 3 },
        { id: 'B', title: 'Task B', start_date: '2026-10-04', end_date: '2026-10-05', base_duration_days: 2 },
        { id: 'C', title: 'Task C', start_date: '2026-10-04', end_date: '2026-10-07', base_duration_days: 4 },
        { id: 'D', title: 'Task D', start_date: '2026-10-08', end_date: '2026-10-09', base_duration_days: 2 },
        { id: 'F', title: 'Task F', start_date: '2026-10-10', end_date: '2026-10-11', base_duration_days: 2 }
      ];

      const dependencies = [
        { id: 'd1', task_id: 'B', depends_on_task_id: 'A' },
        { id: 'd2', task_id: 'C', depends_on_task_id: 'A' },
        { id: 'd3', task_id: 'D', depends_on_task_id: 'B' },
        { id: 'd4', task_id: 'D', depends_on_task_id: 'C' },
        { id: 'd5', task_id: 'F', depends_on_task_id: 'D' }
      ];

      // A shifts by +2 days (from 2026-10-03 to 2026-10-05)
      const { tasks: propagatedTasks } = propagateSchedule({
        changedTaskId: 'A',
        newStartDate: '2026-10-01',
        newEndDate: '2026-10-05',
        tasks: initialTasks,
        dependencies,
        bufferDays: 1
      });

      const taskF = propagatedTasks.find(t => t.id === 'F');
      const taskD = propagatedTasks.find(t => t.id === 'D');

      // D should start at max(B: 10-08, C: 10-10) -> 2026-10-10, end 2026-10-11
      expect(taskD.start_date).toBe('2026-10-10');
      expect(taskD.end_date).toBe('2026-10-11');

      // F should start at D.end + 1 -> 2026-10-12, end 2026-10-13 (shifted exactly by +2 days)
      expect(taskF.start_date).toBe('2026-10-12');
      expect(taskF.end_date).toBe('2026-10-13');
    });
  });

  describe('3.4 Rollback on Regression (Done -> In Progress)', () => {
    test('re-blocks downstream dependents when prerequisite moves back from Done to In Progress', () => {
      // Scenario: Task A was done, Task B was ready. User moves Task A back to in_progress.
      const tasks = [
        { id: 'task-A', title: 'Task A', column_status: 'in_progress', dependency_status: 'ready' },
        { id: 'task-B', title: 'Task B', column_status: 'backlog', dependency_status: 'ready' }
      ];
      // B depends on A
      const dependencies = [{ id: 'dep-1', task_id: 'task-B', depends_on_task_id: 'task-A' }];

      const { tasks: updatedTasks, updatedTasks: changedList } = recomputeGraphDependencyStatuses(tasks, dependencies);

      const taskB = updatedTasks.find(t => t.id === 'task-B');
      expect(taskB.dependency_status).toBe('blocked');
      expect(changedList).toEqual([
        { id: 'task-B', old_dependency_status: 'ready', new_dependency_status: 'blocked' }
      ]);
    });
  });

  describe('Critical Path Calculation', () => {
    test('computes longest dependency path in a DAG', () => {
      const tasks = [
        { id: 'A', title: 'Task A', base_duration_days: 5 },
        { id: 'B', title: 'Task B (Short)', base_duration_days: 2 },
        { id: 'C', title: 'Task C (Long)', base_duration_days: 6 },
        { id: 'D', title: 'Task D', base_duration_days: 3 }
      ];
      // A -> B -> D (path 1: 5 + 2 + 3 = 10 days)
      // A -> C -> D (path 2: 5 + 6 + 3 = 14 days) -> Critical path!
      const dependencies = [
        { id: '1', task_id: 'B', depends_on_task_id: 'A' },
        { id: '2', task_id: 'C', depends_on_task_id: 'A' },
        { id: '3', task_id: 'D', depends_on_task_id: 'B' },
        { id: '4', task_id: 'D', depends_on_task_id: 'C' }
      ];

      const result = calculateCriticalPath(tasks, dependencies);
      expect(result.criticalPathTaskIds).toEqual(['A', 'C', 'D']);
      expect(result.totalDurationDays).toBe(14);
    });
  });

});
