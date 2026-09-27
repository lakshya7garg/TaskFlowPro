import express from 'express';
import { query } from '../config/db.js';
import { calculateCriticalPath } from '../engine/dagEngine.js';

const router = express.Router();

/**
 * GET /api/critical-path
 * Computes and returns the longest dependency chain by duration (Critical Path Method)
 */
router.get('/', async (req, res) => {
  try {
    const tasksRes = await query('SELECT * FROM tasks');
    const depsRes = await query('SELECT * FROM dependencies');

    const result = calculateCriticalPath(tasksRes.rows, depsRes.rows);

    res.json({
      success: true,
      criticalPathTaskIds: result.criticalPathTaskIds,
      totalDurationDays: result.totalDurationDays,
      criticalPathTasks: result.criticalPathTasks
    });
  } catch (err) {
    console.error('Error calculating critical path:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
