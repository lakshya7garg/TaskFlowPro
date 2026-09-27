import express from 'express';
import { query } from '../config/db.js';
import { generateDependencySuggestions } from '../services/geminiService.js';
import { detectCycle, recomputeGraphDependencyStatuses } from '../engine/dagEngine.js';

const router = express.Router();

/**
 * GET /api/tasks/:id/ai-suggestions
 * Get all suggestions (pending, accepted, rejected) for a task
 */
router.get('/tasks/:id/ai-suggestions', async (req, res) => {
  try {
    const { id } = req.params;
    const suggestionsRes = await query(
      `SELECT s.id, s.task_id, s.suggested_depends_on_task_id, s.confidence, s.rationale, s.status, s.created_at,
              t.title as suggested_prereq_title, t.column_status as suggested_prereq_column_status
       FROM ai_suggestions s
       JOIN tasks t ON s.suggested_depends_on_task_id = t.id
       WHERE s.task_id = $1
       ORDER BY s.created_at DESC`,
      [id]
    );

    res.json({
      success: true,
      suggestions: suggestionsRes.rows
    });
  } catch (err) {
    console.error('Error fetching AI suggestions:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/ai-suggestions/generate
 * Generate suggestions using Gemini API and store them as 'pending'
 * Body: { task_id }
 */
router.post('/generate', async (req, res) => {
  try {
    const { task_id } = req.body;
    if (!task_id) {
      return res.status(400).json({ success: false, error: 'task_id is required.' });
    }

    const allTasksRes = await query('SELECT * FROM tasks');
    const targetTask = allTasksRes.rows.find(t => t.id === task_id);

    if (!targetTask) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    const allDepsRes = await query('SELECT * FROM dependencies');
    const existingSuggestionsRes = await query('SELECT * FROM ai_suggestions WHERE task_id = $1', [task_id]);

    // Generate suggestions via Gemini service
    const rawSuggestions = await generateDependencySuggestions({
      targetTask,
      allTasks: allTasksRes.rows,
      existingDependencies: allDepsRes.rows
    });

    // Grounding / Anti-Hallucination deduplication:
    // Only store suggestions that are not already present or active
    const existingSuggestedPrereqIds = new Set(
      existingSuggestionsRes.rows.map(s => s.suggested_depends_on_task_id)
    );
    const existingDepPrereqIds = new Set(
      allDepsRes.rows.filter(d => d.task_id === task_id).map(d => d.depends_on_task_id)
    );

    const insertedSuggestions = [];
    for (const sug of rawSuggestions) {
      if (!existingSuggestedPrereqIds.has(sug.suggested_depends_on_task_id) &&
          !existingDepPrereqIds.has(sug.suggested_depends_on_task_id)) {
        
        const insertRes = await query(
          `INSERT INTO ai_suggestions (task_id, suggested_depends_on_task_id, confidence, rationale, status)
           VALUES ($1, $2, $3, $4, 'pending')
           RETURNING *`,
          [sug.task_id, sug.suggested_depends_on_task_id, sug.confidence, sug.rationale]
        );

        const prereqTask = allTasksRes.rows.find(t => t.id === sug.suggested_depends_on_task_id);
        insertedSuggestions.push({
          ...insertRes.rows[0],
          suggested_prereq_title: prereqTask ? prereqTask.title : 'Task',
          suggested_prereq_column_status: prereqTask ? prereqTask.column_status : 'unknown'
        });
      }
    }

    res.json({
      success: true,
      message: insertedSuggestions.length > 0 
        ? `Generated ${insertedSuggestions.length} dependency suggestions.` 
        : 'No new dependency suggestions identified.',
      suggestions: insertedSuggestions
    });
  } catch (err) {
    console.error('Error generating AI suggestions:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/ai-suggestions/:id/accept
 * Promote AI suggestion into a real dependency edge (Passes through DAG cycle check!)
 */
router.post('/:id/accept', async (req, res) => {
  try {
    const { id } = req.params;

    const sugRes = await query('SELECT * FROM ai_suggestions WHERE id = $1', [id]);
    if (sugRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Suggestion not found.' });
    }

    const suggestion = sugRes.rows[0];

    // Fetch existing tasks & dependencies to run DAG cycle check
    const allTasksRes = await query('SELECT * FROM tasks');
    const allDepsRes = await query('SELECT * FROM dependencies');

    // Run cycle detection
    const cycleCheck = detectCycle(allTasksRes.rows, allDepsRes.rows, {
      task_id: suggestion.task_id,
      depends_on_task_id: suggestion.suggested_depends_on_task_id
    });

    if (cycleCheck.hasCycle) {
      return res.status(400).json({
        success: false,
        cycleDetected: true,
        error: `Cannot accept suggestion: accepting this dependency would create a cycle (${cycleCheck.message})`
      });
    }

    // Insert real dependency edge with source='ai_suggested'
    const insertDepRes = await query(
      `INSERT INTO dependencies (task_id, depends_on_task_id, source)
       VALUES ($1, $2, 'ai_suggested')
       RETURNING *`,
      [suggestion.task_id, suggestion.suggested_depends_on_task_id]
    );

    // Mark suggestion as accepted
    await query(`UPDATE ai_suggestions SET status = 'accepted' WHERE id = $1`, [id]);

    // Recompute graph statuses
    const updatedDepsRes = await query('SELECT * FROM dependencies');
    const { updatedTasks } = recomputeGraphDependencyStatuses(allTasksRes.rows, updatedDepsRes.rows);

    for (const u of updatedTasks) {
      await query('UPDATE tasks SET dependency_status = $1, updated_at = now() WHERE id = $2', [u.new_dependency_status, u.id]);
    }

    res.json({
      success: true,
      message: 'AI suggestion accepted and dependency edge established.',
      dependency: insertDepRes.rows[0],
      cascadeUpdatedTasks: updatedTasks
    });
  } catch (err) {
    console.error('Error accepting AI suggestion:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/ai-suggestions/:id/reject
 * Mark suggestion as rejected
 */
router.post('/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;

    const sugRes = await query('SELECT * FROM ai_suggestions WHERE id = $1', [id]);
    if (sugRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Suggestion not found.' });
    }

    await query(`UPDATE ai_suggestions SET status = 'rejected' WHERE id = $1`, [id]);

    res.json({
      success: true,
      message: 'Suggestion rejected.'
    });
  } catch (err) {
    console.error('Error rejecting AI suggestion:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
