import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDb, query, getDbType } from './config/db.js';
import tasksRouter from './routes/tasks.js';
import dependenciesRouter from './routes/dependencies.js';
import aiSuggestionsRouter from './routes/aiSuggestions.js';
import criticalPathRouter from './routes/criticalPath.js';
import { runSeed } from './scripts/seed.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/tasks', tasksRouter);
app.use('/api/dependencies', dependenciesRouter);
app.use('/api', dependenciesRouter); // Also mounts /api/tasks/:id/dependencies
app.use('/api/ai-suggestions', aiSuggestionsRouter);
app.use('/api', aiSuggestionsRouter); // Also mounts /api/tasks/:id/ai-suggestions
app.use('/api/critical-path', criticalPathRouter);

// Audit logs endpoint for tracking schedule propagations
app.get('/api/audit-logs', async (req, res) => {
  try {
    const logsRes = await query(
      `SELECT a.*, t.title as task_title, trig.title as triggered_by_title
       FROM audit_log a
       LEFT JOIN tasks t ON a.task_id = t.id
       LEFT JOIN tasks trig ON a.triggered_by_task_id = trig.id
       ORDER BY a.created_at DESC
       LIMIT 50`
    );
    res.json({ success: true, logs: logsRes.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Demo reset endpoint
app.post('/api/seed/reset', async (req, res) => {
  try {
    await runSeed();
    res.json({ success: true, message: 'Database reset to initial demo state successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    dbType: getDbType()
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

// Initialize database schema and start server
async function startServer() {
  try {
    await initDb();
    
    // Auto-seed if tasks table is empty
    const checkTasks = await query('SELECT COUNT(*) as count FROM tasks');
    const count = parseInt(checkTasks.rows[0]?.count || 0, 10);
    if (count === 0) {
      console.log('[Init] No tasks detected in database. Automatically running seed...');
      await runSeed();
    }

    app.listen(PORT, () => {
      console.log(`=========================================`);
      console.log(` TaskFlow Pro Backend running on port ${PORT}`);
      console.log(` Database: ${getDbType()}`);
      console.log(` Health: http://localhost:${PORT}/api/health`);
      console.log(`=========================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

export default app;
