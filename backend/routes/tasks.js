import express from 'express';
import { query } from '../config/db.js';
import {
  computeTaskDependencyStatus,
  recomputeGraphDependencyStatuses,
  propagateSchedule,
  formatDate,
  diffDays
} from '../engine/dagEngine.js';
import { validateTaskInput, isValidId } from '../utils/validation.js';

const router = express.Router();

/**
 * GET /api/tasks
 * List all tasks with computed dependency_status and their prerequisite details
 */
router.get('/', async (req, res) => {
  try {
    const tasksRes = await query('SELECT * FROM tasks ORDER BY position ASC, created_at ASC');
    const depsRes = await query('SELECT * FROM dependencies');

    // Always ensure dependency_status is fresh and accurate against current graph
    const { tasks: freshTasks, updatedTasks } = recomputeGraphDependencyStatuses(tasksRes.rows, depsRes.rows);

    // If any status drifted, sync to DB
    for (const u of updatedTasks) {
      await query('UPDATE tasks SET dependency_status = $1, updated_at = now() WHERE id = $2', [u.new_dependency_status, u.id]);
    }

    // Attach prerequisites and dependents info for easy frontend consumption
    const enrichedTasks = freshTasks.map(task => {
      const prerequisites = depsRes.rows
        .filter(d => d.task_id === task.id)
        .map(d => {
          const prereqTask = freshTasks.find(t => t.id === d.depends_on_task_id);
          return {
            dependency_id: d.id,
            prereq_id: d.depends_on_task_id,
            prereq_title: prereqTask ? prereqTask.title : 'Unknown Task',
            prereq_column_status: prereqTask ? prereqTask.column_status : 'unknown',
            source: d.source
          };
        });

      const dependents = depsRes.rows
        .filter(d => d.depends_on_task_id === task.id)
        .map(d => {
          const depTask = freshTasks.find(t => t.id === d.task_id);
          return {
            dependency_id: d.id,
            dependent_id: d.task_id,
            dependent_title: depTask ? depTask.title : 'Unknown Task',
            dependent_column_status: depTask ? depTask.column_status : 'unknown'
          };
        });

      return {
        ...task,
        prerequisites,
        dependents
      };
    });

    res.json({
      success: true,
      tasks: enrichedTasks,
      total: enrichedTasks.length
    });
  } catch (err) {
    console.error('Error fetching tasks:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch tasks.' });
  }
});

/**
 * POST /api/tasks
 * Create a new task with strict input validation
 */
router.post('/', async (req, res) => {
  try {
    const {
      title,
      description = '',
      column_status = 'backlog',
      start_date = null,
      end_date = null,
      base_duration_days = 1,
      position = 0
    } = req.body;

    const validation = validateTaskInput({
      title,
      column_status,
      start_date,
      end_date,
      base_duration_days
    }, true);

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.errors.join(' ')
      });
    }

    // Calculate base duration if dates are given
    let duration = parseInt(base_duration_days, 10) || 1;
    if (start_date && end_date) {
      duration = Math.max(1, diffDays(start_date, end_date) + 1);
    }

    const insertRes = await query(
      `INSERT INTO tasks (title, description, column_status, dependency_status, start_date, end_date, base_duration_days, position)
       VALUES ($1, $2, $3, 'ready', $4, $5, $6, $7)
       RETURNING *`,
      [
        title.trim(),
        description ? description.trim() : '',
        column_status,
        formatDate(start_date),
        formatDate(end_date),
        duration,
        parseInt(position, 10) || 0
      ]
    );

    const newTask = insertRes.rows[0];

    res.status(201).json({
      success: true,
      task: {
        ...newTask,
        prerequisites: [],
        dependents: []
      }
    });
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ success: false, error: 'Failed to create task.' });
  }
});

/**
 * PATCH /api/tasks/:id
 * Update task attributes (title, description, dates, column_status, position)
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid task ID format.' });
    }

    const {
      title,
      description,
      column_status,
      start_date,
      end_date,
      base_duration_days,
      position
    } = req.body;

    const validation = validateTaskInput({
      title,
      column_status,
      start_date,
      end_date,
      base_duration_days
    });

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.errors.join(' ')
      });
    }

    const currentTaskRes = await query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (currentTaskRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    const currentTask = currentTaskRes.rows[0];

    // Status change validation: prevent moving a blocked task to in_progress/review/done
    if (column_status && column_status !== currentTask.column_status && column_status !== 'backlog') {
      const depsRes = await query('SELECT * FROM dependencies WHERE task_id = $1', [id]);
      if (depsRes.rowCount > 0) {
        const allTasksRes = await query('SELECT * FROM tasks');
        const computedStatus = computeTaskDependencyStatus(id, allTasksRes.rows, depsRes.rows);
        if (computedStatus === 'blocked') {
          return res.status(400).json({
            success: false,
            error: `Cannot move task to "${column_status}": it is currently BLOCKED by unmet prerequisite tasks.`
          });
        }
      }
    }

    const updatedTitle = title !== undefined ? title.trim() : currentTask.title;
    const updatedDesc = description !== undefined ? (description ? description.trim() : '') : currentTask.description;
    const updatedCol = column_status !== undefined ? column_status : currentTask.column_status;
    const updatedStart = start_date !== undefined ? formatDate(start_date) : currentTask.start_date;
    const updatedEnd = end_date !== undefined ? formatDate(end_date) : currentTask.end_date;
    let updatedDur = base_duration_days !== undefined ? parseInt(base_duration_days, 10) : currentTask.base_duration_days;
    if (start_date && end_date) {
      updatedDur = Math.max(1, diffDays(start_date, end_date) + 1);
    }
    const updatedPos = position !== undefined ? parseInt(position, 10) : currentTask.position;

    await query(
      `UPDATE tasks
       SET title = $1, description = $2, column_status = $3, start_date = $4, end_date = $5,
           base_duration_days = $6, position = $7, updated_at = now()
       WHERE id = $8`,
      [updatedTitle, updatedDesc, updatedCol, updatedStart, updatedEnd, updatedDur, updatedPos, id]
    );

    // If column status changed, cascade dependency_status across the DAG
    if (column_status && column_status !== currentTask.column_status) {
      const allTasks = await query('SELECT * FROM tasks');
      const allDeps = await query('SELECT * FROM dependencies');
      const { updatedTasks } = recomputeGraphDependencyStatuses(allTasks.rows, allDeps.rows);

      for (const u of updatedTasks) {
        await query('UPDATE tasks SET dependency_status = $1, updated_at = now() WHERE id = $2', [u.new_dependency_status, u.id]);
      }
    }

    // Return updated task
    const refreshed = await query('SELECT * FROM tasks WHERE id = $1', [id]);
    res.json({
      success: true,
      task: refreshed.rows[0]
    });
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(500).json({ success: false, error: 'Failed to update task.' });
  }
});

/**
 * POST /api/tasks/:id/move
 * Drag-and-drop move endpoint (updates column_status + position and triggers DAG cascade)
 */
router.post('/:id/move', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid task ID format.' });
    }

    const { column_status, position = 0 } = req.body;

    const validation = validateTaskInput({ column_status });
    if (!validation.isValid) {
      return res.status(400).json({ success: false, error: validation.errors.join(' ') });
    }

    const currentTaskRes = await query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (currentTaskRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    const currentTask = currentTaskRes.rows[0];

    // Enforce dependency blocking rule: cannot move a blocked task to active columns (in_progress, review, done)
    if (column_status !== 'backlog' && currentTask.dependency_status === 'blocked') {
      const prereqsRes = await query(
        `SELECT t.id, t.title, t.column_status
         FROM dependencies d
         JOIN tasks t ON d.depends_on_task_id = t.id
         WHERE d.task_id = $1 AND t.column_status != 'done'`,
        [id]
      );

      const unmetNames = prereqsRes.rows.map(p => `"${p.title}" (${p.column_status})`).join(', ');

      return res.status(400).json({
        success: false,
        error: `Cannot move blocked task to "${column_status}". Unmet prerequisite(s): ${unmetNames || 'Incomplete dependencies'}.`
      });
    }

    // Update target task column and position
    await query(
      `UPDATE tasks SET column_status = $1, position = $2, updated_at = now() WHERE id = $3`,
      [column_status, parseInt(position, 10) || 0, id]
    );

    // Run DAG cascade recomputation
    const allTasksRes = await query('SELECT * FROM tasks');
    const allDepsRes = await query('SELECT * FROM dependencies');
    const { updatedTasks } = recomputeGraphDependencyStatuses(allTasksRes.rows, allDepsRes.rows);

    for (const u of updatedTasks) {
      await query('UPDATE tasks SET dependency_status = $1, updated_at = now() WHERE id = $2', [u.new_dependency_status, u.id]);
    }

    res.json({
      success: true,
      message: `Task moved to ${column_status}`,
      updatedCascadeCount: updatedTasks.length
    });
  } catch (err) {
    console.error('Error moving task:', err);
    res.status(500).json({ success: false, error: 'Failed to move task.' });
  }
});

/**
 * POST /api/tasks/:id/reschedule
 * Schedule propagation endpoint (No-compounding topological propagation)
 */
router.post('/:id/reschedule', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid task ID format.' });
    }

    const { start_date, end_date, buffer_days = 1 } = req.body;

    if (!end_date) {
      return res.status(400).json({ success: false, error: 'end_date is required for rescheduling.' });
    }

    const validation = validateTaskInput({ start_date, end_date });
    if (!validation.isValid) {
      return res.status(400).json({ success: false, error: validation.errors.join(' ') });
    }

    const allTasksRes = await query('SELECT * FROM tasks');
    const targetTask = allTasksRes.rows.find(t => t.id === id);
    if (!targetTask) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    const allDepsRes = await query('SELECT * FROM dependencies');

    const { tasks: propagatedTasks, auditLogs } = propagateSchedule({
      changedTaskId: id,
      newStartDate: start_date,
      newEndDate: end_date,
      tasks: allTasksRes.rows,
      dependencies: allDepsRes.rows,
      bufferDays: parseInt(buffer_days, 10) || 1
    });

    // Persist all propagated date changes to database
    for (const t of propagatedTasks) {
      await query(
        `UPDATE tasks
         SET start_date = $1, end_date = $2, base_duration_days = $3, updated_at = now()
         WHERE id = $4`,
        [t.start_date, t.end_date, t.base_duration_days, t.id]
      );
    }

    // Persist audit log entries
    for (const log of auditLogs) {
      await query(
        `INSERT INTO audit_log (task_id, old_end_date, new_end_date, triggered_by_task_id, action, details)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [log.task_id, log.old_end_date, log.new_end_date, log.triggered_by_task_id, log.action, log.details]
      );
    }

    res.json({
      success: true,
      message: `Schedule propagated successfully. ${auditLogs.length} downstream tasks adjusted.`,
      propagatedTasks,
      auditLogs
    });
  } catch (err) {
    console.error('Error rescheduling task:', err);
    res.status(500).json({ success: false, error: 'Failed to reschedule task.' });
  }
});

/**
 * DELETE /api/tasks/:id
 * Delete task and recompute dependency statuses
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid task ID format.' });
    }

    const taskRes = await query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (taskRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    await query('DELETE FROM tasks WHERE id = $1', [id]);

    // Recompute graph dependency statuses after task deletion
    const allTasksRes = await query('SELECT * FROM tasks');
    const allDepsRes = await query('SELECT * FROM dependencies');
    const { updatedTasks } = recomputeGraphDependencyStatuses(allTasksRes.rows, allDepsRes.rows);

    for (const u of updatedTasks) {
      await query('UPDATE tasks SET dependency_status = $1, updated_at = now() WHERE id = $2', [u.new_dependency_status, u.id]);
    }

    res.json({
      success: true,
      message: 'Task deleted successfully.',
      cascadeUpdatedTasks: updatedTasks
    });
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(500).json({ success: false, error: 'Failed to delete task.' });
  }
});

export default router;
