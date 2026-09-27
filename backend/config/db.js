import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

let pool = null;
let dbType = 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;

// In-Memory Storage Data Structures (Zero-Config Turnkey Mode)
const memStore = {
  tasks: new Map(),
  dependencies: new Map(),
  ai_suggestions: new Map(),
  audit_log: new Map()
};

// Check if real PostgreSQL database connection is provided
if (DATABASE_URL && !process.env.FORCE_MEM) {
  try {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    dbType = 'postgres';
    console.log('[DB] PostgreSQL pool configured with DATABASE_URL');
  } catch (err) {
    console.warn('[DB] Failed to initialize PostgreSQL pool, falling back to in-memory store:', err.message);
    dbType = 'memory';
  }
} else {
  dbType = 'memory';
  console.log('[DB] Running with in-memory store (set DATABASE_URL in .env for PostgreSQL)');
}

/**
 * Universal Query Engine
 * Works transparently with PostgreSQL Pool (when DATABASE_URL is set)
 * or built-in Memory Store (zero-config local demo & testing).
 */
export async function query(text, params = []) {
  if (dbType === 'postgres' && pool) {
    try {
      const res = await pool.query(text, params);
      return res;
    } catch (err) {
      console.error('[DB PostgreSQL Error]:', err.message);
      throw err;
    }
  }

  // Pure In-Memory DB Engine Implementation
  const cleanSql = text.trim();

  // 1. DELETE queries
  if (/^DELETE\s+FROM\s+audit_log/i.test(cleanSql)) {
    const count = memStore.audit_log.size;
    memStore.audit_log.clear();
    return { rows: [], rowCount: count };
  }
  if (/^DELETE\s+FROM\s+ai_suggestions/i.test(cleanSql)) {
    const count = memStore.ai_suggestions.size;
    memStore.ai_suggestions.clear();
    return { rows: [], rowCount: count };
  }
  if (/^DELETE\s+FROM\s+dependencies\s+WHERE\s+id\s*=\s*\$1/i.test(cleanSql)) {
    const id = params[0];
    const exists = memStore.dependencies.has(id);
    memStore.dependencies.delete(id);
    return { rows: [], rowCount: exists ? 1 : 0 };
  }
  if (/^DELETE\s+FROM\s+dependencies/i.test(cleanSql)) {
    const count = memStore.dependencies.size;
    memStore.dependencies.clear();
    return { rows: [], rowCount: count };
  }
  if (/^DELETE\s+FROM\s+tasks\s+WHERE\s+id\s*=\s*\$1/i.test(cleanSql)) {
    const id = params[0];
    const exists = memStore.tasks.has(id);
    memStore.tasks.delete(id);
    // Cascade delete dependencies
    for (const [depId, dep] of memStore.dependencies.entries()) {
      if (dep.task_id === id || dep.depends_on_task_id === id) {
        memStore.dependencies.delete(depId);
      }
    }
    // Cascade delete suggestions
    for (const [sugId, sug] of memStore.ai_suggestions.entries()) {
      if (sug.task_id === id || sug.suggested_depends_on_task_id === id) {
        memStore.ai_suggestions.delete(sugId);
      }
    }
    return { rows: [], rowCount: exists ? 1 : 0 };
  }
  if (/^DELETE\s+FROM\s+tasks/i.test(cleanSql)) {
    const count = memStore.tasks.size;
    memStore.tasks.clear();
    memStore.dependencies.clear();
    memStore.ai_suggestions.clear();
    return { rows: [], rowCount: count };
  }

  // 2. COUNT queries
  if (/SELECT\s+COUNT\(\*\)\s+as\s+count\s+FROM\s+tasks/i.test(cleanSql)) {
    return { rows: [{ count: memStore.tasks.size }], rowCount: 1 };
  }

  // 3. SELECT tasks
  if (/SELECT\s+\*\s+FROM\s+tasks\s+WHERE\s+id\s*=\s*\$1/i.test(cleanSql)) {
    const task = memStore.tasks.get(params[0]);
    return { rows: task ? [{ ...task }] : [], rowCount: task ? 1 : 0 };
  }
  if (/SELECT\s+\*\s+FROM\s+tasks/i.test(cleanSql)) {
    const all = Array.from(memStore.tasks.values())
      .sort((a, b) => (a.position || 0) - (b.position || 0));
    return { rows: all.map(t => ({ ...t })), rowCount: all.length };
  }

  // 4. SELECT dependencies
  if (/FROM\s+dependencies\s+d\s+JOIN\s+tasks\s+t\s+ON\s+d\.depends_on_task_id\s*=\s*t\.id\s+WHERE\s+d\.task_id\s*=\s*\$1/i.test(cleanSql)) {
    const taskId = params[0];
    const rows = [];
    for (const dep of memStore.dependencies.values()) {
      if (dep.task_id === taskId) {
        const prereq = memStore.tasks.get(dep.depends_on_task_id);
        if (prereq) {
          rows.push({
            dependency_id: dep.id,
            source: dep.source,
            created_at: dep.created_at,
            prereq_task_id: prereq.id,
            title: prereq.title,
            column_status: prereq.column_status,
            dependency_status: prereq.dependency_status,
            start_date: prereq.start_date,
            end_date: prereq.end_date,
            base_duration_days: prereq.base_duration_days
          });
        }
      }
    }
    return { rows, rowCount: rows.length };
  }
  if (/SELECT\s+\*\s+FROM\s+dependencies\s+WHERE\s+id\s*=\s*\$1/i.test(cleanSql)) {
    const dep = memStore.dependencies.get(params[0]);
    return { rows: dep ? [{ ...dep }] : [], rowCount: dep ? 1 : 0 };
  }
  if (/SELECT\s+\*\s+FROM\s+dependencies\s+WHERE\s+task_id\s*=\s*\$1/i.test(cleanSql)) {
    const rows = Array.from(memStore.dependencies.values()).filter(d => d.task_id === params[0]);
    return { rows: rows.map(r => ({ ...r })), rowCount: rows.length };
  }
  if (/SELECT\s+\*\s+FROM\s+dependencies/i.test(cleanSql)) {
    const all = Array.from(memStore.dependencies.values());
    return { rows: all.map(d => ({ ...d })), rowCount: all.length };
  }

  // 5. SELECT ai_suggestions
  if (/FROM\s+ai_suggestions\s+s\s+JOIN\s+tasks\s+t\s+ON\s+s\.suggested_depends_on_task_id\s*=\s*t\.id\s+WHERE\s+s\.task_id\s*=\s*\$1/i.test(cleanSql)) {
    const taskId = params[0];
    const rows = [];
    for (const sug of memStore.ai_suggestions.values()) {
      if (sug.task_id === taskId) {
        const prereq = memStore.tasks.get(sug.suggested_depends_on_task_id);
        rows.push({
          ...sug,
          suggested_prereq_title: prereq ? prereq.title : 'Task',
          suggested_prereq_column_status: prereq ? prereq.column_status : 'unknown'
        });
      }
    }
    return { rows, rowCount: rows.length };
  }
  if (/SELECT\s+\*\s+FROM\s+ai_suggestions\s+WHERE\s+id\s*=\s*\$1/i.test(cleanSql)) {
    const sug = memStore.ai_suggestions.get(params[0]);
    return { rows: sug ? [{ ...sug }] : [], rowCount: sug ? 1 : 0 };
  }
  if (/SELECT\s+\*\s+FROM\s+ai_suggestions\s+WHERE\s+task_id\s*=\s*\$1/i.test(cleanSql)) {
    const rows = Array.from(memStore.ai_suggestions.values()).filter(s => s.task_id === params[0]);
    return { rows: rows.map(r => ({ ...r })), rowCount: rows.length };
  }

  // 6. SELECT audit_log
  if (/SELECT\s+a\.\*.*FROM\s+audit_log/i.test(cleanSql)) {
    const all = Array.from(memStore.audit_log.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const enriched = all.map(l => {
      const task = memStore.tasks.get(l.task_id);
      const trig = l.triggered_by_task_id ? memStore.tasks.get(l.triggered_by_task_id) : null;
      return {
        ...l,
        task_title: task ? task.title : 'Unknown',
        triggered_by_title: trig ? trig.title : 'Direct update'
      };
    });
    return { rows: enriched.slice(0, 50), rowCount: enriched.length };
  }

  // 7. INSERT queries
  if (/^INSERT\s+INTO\s+tasks/i.test(cleanSql)) {
    let newTask;
    if (params.length === 9) {
      // Direct full insert with ID from seed
      newTask = {
        id: params[0] || uuidv4(),
        title: params[1],
        description: params[2] || '',
        column_status: params[3] || 'backlog',
        dependency_status: params[4] || 'ready',
        start_date: params[5],
        end_date: params[6],
        base_duration_days: params[7] || 1,
        position: params[8] || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    } else {
      // Standard create
      newTask = {
        id: uuidv4(),
        title: params[0],
        description: params[1] || '',
        column_status: params[2] || 'backlog',
        dependency_status: 'ready',
        start_date: params[3],
        end_date: params[4],
        base_duration_days: params[5] || 1,
        position: params[6] || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }
    memStore.tasks.set(newTask.id, newTask);
    return { rows: [newTask], rowCount: 1 };
  }

  if (/^INSERT\s+INTO\s+dependencies/i.test(cleanSql)) {
    const newDep = {
      id: uuidv4(),
      task_id: params[0],
      depends_on_task_id: params[1],
      source: params[2] || 'manual',
      created_at: new Date().toISOString()
    };
    memStore.dependencies.set(newDep.id, newDep);
    return { rows: [newDep], rowCount: 1 };
  }

  if (/^INSERT\s+INTO\s+ai_suggestions/i.test(cleanSql)) {
    const newSug = {
      id: uuidv4(),
      task_id: params[0],
      suggested_depends_on_task_id: params[1],
      confidence: params[2] || 'medium',
      rationale: params[3] || '',
      status: 'pending',
      created_at: new Date().toISOString()
    };
    memStore.ai_suggestions.set(newSug.id, newSug);
    return { rows: [newSug], rowCount: 1 };
  }

  if (/^INSERT\s+INTO\s+audit_log/i.test(cleanSql)) {
    const newLog = {
      id: uuidv4(),
      task_id: params[0],
      old_end_date: params[1],
      new_end_date: params[2],
      triggered_by_task_id: params[3],
      action: params[4] || 'schedule_propagation',
      details: params[5] || '',
      created_at: new Date().toISOString()
    };
    memStore.audit_log.set(newLog.id, newLog);
    return { rows: [newLog], rowCount: 1 };
  }

  // 8. UPDATE queries
  if (/UPDATE\s+tasks\s+SET\s+dependency_status\s*=\s*\$1.*WHERE\s+id\s*=\s*\$2/i.test(cleanSql)) {
    const task = memStore.tasks.get(params[1]);
    if (task) {
      task.dependency_status = params[0];
      task.updated_at = new Date().toISOString();
    }
    return { rows: task ? [task] : [], rowCount: task ? 1 : 0 };
  }

  if (/UPDATE\s+tasks\s+SET\s+column_status\s*=\s*\$1,\s*position\s*=\s*\$2.*WHERE\s+id\s*=\s*\$3/i.test(cleanSql)) {
    const task = memStore.tasks.get(params[2]);
    if (task) {
      task.column_status = params[0];
      task.position = params[1];
      task.updated_at = new Date().toISOString();
    }
    return { rows: task ? [task] : [], rowCount: task ? 1 : 0 };
  }

  if (/UPDATE\s+tasks\s+SET\s+start_date\s*=\s*\$1,\s*end_date\s*=\s*\$2,\s*base_duration_days\s*=\s*\$3.*WHERE\s+id\s*=\s*\$4/i.test(cleanSql)) {
    const task = memStore.tasks.get(params[3]);
    if (task) {
      task.start_date = params[0];
      task.end_date = params[1];
      task.base_duration_days = params[2];
      task.updated_at = new Date().toISOString();
    }
    return { rows: task ? [task] : [], rowCount: task ? 1 : 0 };
  }

  if (/UPDATE\s+tasks\s+SET\s+title\s*=\s*\$1.*WHERE\s+id\s*=\s*\$8/i.test(cleanSql)) {
    const task = memStore.tasks.get(params[7]);
    if (task) {
      task.title = params[0];
      task.description = params[1];
      task.column_status = params[2];
      task.start_date = params[3];
      task.end_date = params[4];
      task.base_duration_days = params[5];
      task.position = params[6];
      task.updated_at = new Date().toISOString();
    }
    return { rows: task ? [task] : [], rowCount: task ? 1 : 0 };
  }

  if (/UPDATE\s+ai_suggestions\s+SET\s+status\s*=\s*'accepted'\s+WHERE\s+id\s*=\s*\$1/i.test(cleanSql)) {
    const sug = memStore.ai_suggestions.get(params[0]);
    if (sug) {
      sug.status = 'accepted';
    }
    return { rows: sug ? [sug] : [], rowCount: sug ? 1 : 0 };
  }

  if (/UPDATE\s+ai_suggestions\s+SET\s+status\s*=\s*'rejected'\s+WHERE\s+id\s*=\s*\$1/i.test(cleanSql)) {
    const sug = memStore.ai_suggestions.get(params[0]);
    if (sug) {
      sug.status = 'rejected';
    }
    return { rows: sug ? [sug] : [], rowCount: sug ? 1 : 0 };
  }

  // Fallback
  return { rows: [], rowCount: 0 };
}

/**
 * Initialize DB schema
 */
export async function initDb() {
  if (dbType === 'postgres' && pool) {
    const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schemaSql);
    console.log('[DB] PostgreSQL schema initialized successfully.');
  } else {
    console.log('[DB] In-memory store ready.');
  }
}

export function getDbType() {
  return dbType;
}

export default {
  query,
  initDb,
  getDbType
};
