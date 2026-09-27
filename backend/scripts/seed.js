import { query, initDb } from '../config/db.js';
import { recomputeGraphDependencyStatuses } from '../engine/dagEngine.js';

export async function runSeed() {
  console.log('[Seed] Seeding database with realistic DAG workflow tasks...');
  await initDb();

  // Clear existing tables
  await query('DELETE FROM audit_log');
  await query('DELETE FROM ai_suggestions');
  await query('DELETE FROM dependencies');
  await query('DELETE FROM tasks');

  // Realistic seed dataset with diamond convergence (T1 -> T2 -> T4 and T1 -> T3 -> T4)
  const taskDefinitions = [
    {
      id: 'a0000000-0000-0000-0000-000000000001',
      title: 'Design DB Schema & System Architecture',
      description: 'Define relational entities, PostgreSQL constraints, and API interface contracts.',
      column_status: 'done',
      dependency_status: 'ready',
      start_date: '2026-10-01',
      end_date: '2026-10-03',
      base_duration_days: 3,
      position: 0
    },
    {
      id: 'a0000000-0000-0000-0000-000000000002',
      title: 'Implement Core REST API & Auth Module',
      description: 'Build Express routes, DAG engine services, and JWT authentication middleware.',
      column_status: 'in_progress',
      dependency_status: 'ready',
      start_date: '2026-10-04',
      end_date: '2026-10-07',
      base_duration_days: 4,
      position: 0
    },
    {
      id: 'a0000000-0000-0000-0000-000000000003',
      title: 'Develop UI Components & Theme System',
      description: 'Create Kanban columns, draggable cards, SVG graph visualizations, and Tailwind styles.',
      column_status: 'in_progress',
      dependency_status: 'ready',
      start_date: '2026-10-04',
      end_date: '2026-10-07',
      base_duration_days: 4,
      position: 1
    },
    {
      id: 'a0000000-0000-0000-0000-000000000004',
      title: 'Integrate Frontend with Backend API',
      description: 'Wire React components to REST endpoints, error toasts, and live optimistic state.',
      column_status: 'backlog',
      dependency_status: 'blocked',
      start_date: '2026-10-08',
      end_date: '2026-10-10',
      base_duration_days: 3,
      position: 0
    },
    {
      id: 'a0000000-0000-0000-0000-000000000005',
      title: 'Setup CI/CD Pipeline & Docker',
      description: 'Configure GitHub Actions test runners and Docker multi-stage container build.',
      column_status: 'done',
      dependency_status: 'ready',
      start_date: '2026-10-01',
      end_date: '2026-10-02',
      base_duration_days: 2,
      position: 1
    },
    {
      id: 'a0000000-0000-0000-0000-000000000006',
      title: 'Execute Automated Integration & E2E Tests',
      description: 'Run Jest DAG tests, diamond schedule tests, and end-to-end Cypress/Playwright suites.',
      column_status: 'backlog',
      dependency_status: 'blocked',
      start_date: '2026-10-11',
      end_date: '2026-10-12',
      base_duration_days: 2,
      position: 1
    },
    {
      id: 'a0000000-0000-0000-0000-000000000007',
      title: 'Performance Optimization & Load Testing',
      description: 'Benchmark DAG topological traversal, CPM calculations, and PostgreSQL query indices.',
      column_status: 'backlog',
      dependency_status: 'blocked',
      start_date: '2026-10-13',
      end_date: '2026-10-14',
      base_duration_days: 2,
      position: 2
    },
    {
      id: 'a0000000-0000-0000-0000-000000000008',
      title: 'Security Audit & Vulnerability Assessment',
      description: 'Perform SQL injection audits, CORS verification, and LLM prompt grounding checks.',
      column_status: 'backlog',
      dependency_status: 'blocked',
      start_date: '2026-10-13',
      end_date: '2026-10-14',
      base_duration_days: 2,
      position: 3
    },
    {
      id: 'a0000000-0000-0000-0000-000000000009',
      title: 'Production Deployment & Demo Presentation',
      description: 'Deploy web app, verify live demo flows, and prepare hackathon presentation video.',
      column_status: 'backlog',
      dependency_status: 'blocked',
      start_date: '2026-10-15',
      end_date: '2026-10-15',
      base_duration_days: 1,
      position: 4
    }
  ];

  // Insert tasks
  for (const t of taskDefinitions) {
    await query(
      `INSERT INTO tasks (id, title, description, column_status, dependency_status, start_date, end_date, base_duration_days, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [t.id, t.title, t.description, t.column_status, t.dependency_status, t.start_date, t.end_date, t.base_duration_days, t.position]
    );
  }

  // Dependency Edges
  // Diamond: T1 -> T2 -> T4, T1 -> T3 -> T4
  // Convergence 2: (T4, T5) -> T6 -> (T7, T8) -> T9
  const dependencyDefinitions = [
    { task_id: 'a0000000-0000-0000-0000-000000000002', depends_on_task_id: 'a0000000-0000-0000-0000-000000000001', source: 'manual' }, // T2 depends on T1
    { task_id: 'a0000000-0000-0000-0000-000000000003', depends_on_task_id: 'a0000000-0000-0000-0000-000000000001', source: 'manual' }, // T3 depends on T1
    { task_id: 'a0000000-0000-0000-0000-000000000004', depends_on_task_id: 'a0000000-0000-0000-0000-000000000002', source: 'manual' }, // T4 depends on T2
    { task_id: 'a0000000-0000-0000-0000-000000000004', depends_on_task_id: 'a0000000-0000-0000-0000-000000000003', source: 'manual' }, // T4 depends on T3
    { task_id: 'a0000000-0000-0000-0000-000000000006', depends_on_task_id: 'a0000000-0000-0000-0000-000000000004', source: 'manual' }, // T6 depends on T4
    { task_id: 'a0000000-0000-0000-0000-000000000006', depends_on_task_id: 'a0000000-0000-0000-0000-000000000005', source: 'manual' }, // T6 depends on T5
    { task_id: 'a0000000-0000-0000-0000-000000000007', depends_on_task_id: 'a0000000-0000-0000-0000-000000000006', source: 'manual' }, // T7 depends on T6
    { task_id: 'a0000000-0000-0000-0000-000000000008', depends_on_task_id: 'a0000000-0000-0000-0000-000000000006', source: 'manual' }, // T8 depends on T6
    { task_id: 'a0000000-0000-0000-0000-000000000009', depends_on_task_id: 'a0000000-0000-0000-0000-000000000007', source: 'manual' }, // T9 depends on T7
    { task_id: 'a0000000-0000-0000-0000-000000000009', depends_on_task_id: 'a0000000-0000-0000-0000-000000000008', source: 'manual' }  // T9 depends on T8
  ];

  for (const dep of dependencyDefinitions) {
    await query(
      `INSERT INTO dependencies (task_id, depends_on_task_id, source)
       VALUES ($1, $2, $3)`,
      [dep.task_id, dep.depends_on_task_id, dep.source]
    );
  }

  // Pre-seed a couple of pending AI suggestions for demonstration
  const aiSuggestionDefinitions = [
    {
      task_id: 'a0000000-0000-0000-0000-000000000009',
      suggested_depends_on_task_id: 'a0000000-0000-0000-0000-000000000006',
      confidence: 'high',
      rationale: 'Deployment and demo should verify test automation runs before going live.'
    }
  ];

  for (const s of aiSuggestionDefinitions) {
    await query(
      `INSERT INTO ai_suggestions (task_id, suggested_depends_on_task_id, confidence, rationale, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [s.task_id, s.suggested_depends_on_task_id, s.confidence, s.rationale]
    );
  }

  // Recompute all dependency statuses accurately
  const tasksRes = await query('SELECT * FROM tasks');
  const depsRes = await query('SELECT * FROM dependencies');
  const { tasks: computedTasks } = recomputeGraphDependencyStatuses(tasksRes.rows, depsRes.rows);

  for (const t of computedTasks) {
    await query('UPDATE tasks SET dependency_status = $1 WHERE id = $2', [t.dependency_status, t.id]);
  }

  console.log(`[Seed] Seeded ${taskDefinitions.length} tasks and ${dependencyDefinitions.length} dependencies successfully.`);
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  runSeed()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[Seed Error]:', err);
      process.exit(1);
    });
}
