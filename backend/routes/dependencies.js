import express from 'express';
import { query } from '../config/db.js';
import {
  detectCycle,
  recomputeGraphDependencyStatuses
} from '../engine/dagEngine.js';
import { validateDependencyInput, isValidId } from '../utils/validation.js';

const router = express.Router();

/**
 * GET /api/tasks/:id/dependencies
 * Get all prerequisites for a task
 */
router.get('/tasks/:id/dependencies', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid task ID format.' });
    }

    const depsRes = await query(
      `SELECT d.id as dependency_id, d.source, d.created_at,
              t.id as prereq_task_id, t.title, t.column_status, t.dependency_status,
              t.start_date, t.end_date, t.base_duration_days
       FROM dependencies d
       JOIN tasks t ON d.depends_on_task_id = t.id
       WHERE d.task_id = $1`,
      [id]
    );

    res.json({
      success: true,
      prerequisites: depsRes.rows
    });
  } catch (err) {
    console.error('Error fetching task dependencies:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch task dependencies.' });
  }
});

/**
 * POST /api/dependencies
 * Add a new dependency edge (Runs cycle detection first!)
 * Body: { task_id, depends_on_task_id, source = 'manual' }
 */
router.post('/', async (req, res) => {
  try {
    const { task_id, depends_on_task_id, source = 'manual' } = req.body;

    const validation = validateDependencyInput({ task_id, depends_on_task_id });
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.errors.join(' ')
      });
    }

    // Fetch existing tasks & dependencies to construct graph
    const allTasksRes = await query('SELECT * FROM tasks');
    const allDepsRes = await query('SELECT * FROM dependencies');

    // Verify both tasks exist
    const downstreamTask = allTasksRes.rows.find(t => t.id === task_id);
    const prereqTask = allTasksRes.rows.find(t => t.id === depends_on_task_id);

    if (!downstreamTask || !prereqTask) {
      return res.status(404).json({
        success: false,
        error: 'One or both specified tasks do not exist.'
      });
    }

    // Check if edge already exists
    const duplicate = allDepsRes.rows.find(
      d => d.task_id === task_id && d.depends_on_task_id === depends_on_task_id
    );
    if (duplicate) {
      return res.status(400).json({
        success: false,
        error: `Dependency already exists: "${downstreamTask.title}" already depends on "${prereqTask.title}".`
      });
    }

    // RUN DAG CYCLE DETECTION
    const cycleCheck = detectCycle(allTasksRes.rows, allDepsRes.rows, {
      task_id,
      depends_on_task_id
    });

    if (cycleCheck.hasCycle) {
      // Reject write - graph remains completely unchanged
      return res.status(400).json({
        success: false,
        cycleDetected: true,
        cyclePath: cycleCheck.cyclePath,
        error: cycleCheck.message
      });
    }

    // Persist new edge
    const insertRes = await query(
      `INSERT INTO dependencies (task_id, depends_on_task_id, source)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [task_id, depends_on_task_id, source || 'manual']
    );

    // Recompute graph dependency statuses
    const updatedDepsRes = await query('SELECT * FROM dependencies');
    const { updatedTasks } = recomputeGraphDependencyStatuses(allTasksRes.rows, updatedDepsRes.rows);

    for (const u of updatedTasks) {
      await query('UPDATE tasks SET dependency_status = $1, updated_at = now() WHERE id = $2', [u.new_dependency_status, u.id]);
    }

    res.status(201).json({
      success: true,
      dependency: insertRes.rows[0],
      message: `Dependency added: "${downstreamTask.title}" now depends on "${prereqTask.title}".`,
      cascadeUpdatedTasks: updatedTasks
    });
  } catch (err) {
    console.error('Error adding dependency:', err);
    res.status(500).json({ success: false, error: 'Failed to add dependency.' });
  }
});

/**
 * DELETE /api/dependencies/:id
 * Remove a dependency edge
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid dependency ID format.' });
    }

    const depRes = await query('SELECT * FROM dependencies WHERE id = $1', [id]);
    if (depRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Dependency edge not found.' });
    }

    await query('DELETE FROM dependencies WHERE id = $1', [id]);

    // Recompute graph statuses
    const allTasksRes = await query('SELECT * FROM tasks');
    const allDepsRes = await query('SELECT * FROM dependencies');
    const { updatedTasks } = recomputeGraphDependencyStatuses(allTasksRes.rows, allDepsRes.rows);

    for (const u of updatedTasks) {
      await query('UPDATE tasks SET dependency_status = $1, updated_at = now() WHERE id = $2', [u.new_dependency_status, u.id]);
    }

    res.json({
      success: true,
      message: 'Dependency removed successfully.',
      cascadeUpdatedTasks: updatedTasks
    });
  } catch (err) {
    console.error('Error removing dependency:', err);
    res.status(500).json({ success: false, error: 'Failed to remove dependency.' });
  }
});

export default router;
