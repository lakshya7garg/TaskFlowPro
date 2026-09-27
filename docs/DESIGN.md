# TaskFlow Pro — System Design & Architecture Document

This document provides a complete technical design overview of **TaskFlow Pro**, a dependency-aware project management platform with an integrated Directed Acyclic Graph (DAG) engine and AI-augmented dependency suggestions.

---

## 1. Architecture Overview

TaskFlow Pro is built using a clean, decoupled client-server architecture with an isolated DAG engine at its core.

```
+-------------------------------------------------------------------------------+
|                               FRONTEND (React + Vite)                         |
|  +--------------------------+  +-----------------------+  +----------------+  |
|  | Kanban Board (@dnd)      |  | Interactive DAG (SVG) |  | Modals & Toast |  |
|  | - Blocked/Ready badges   |  | - Diamond paths       |  | - AI Suggests  |  |
|  | - Unmet prereq tooltips  |  | - Critical Path glow  |  | - Audit Log    |  |
|  +--------------------------+  +-----------------------+  +----------------+  |
+---------------------------------------+---------------------------------------+
                                        | REST API Requests (/api/*)
                                        v
+-------------------------------------------------------------------------------+
|                             BACKEND (Node.js + Express)                       |
|  +-------------------------------------------------------------------------+  |
|  | Isolated DAG Engine (backend/engine/dagEngine.js)                       |  |
|  | - Cycle Detection (DFS recursion stack & path tracing)                  |  |
|  | - Blocked/Ready Cascade (Topological recomputation on status change)   |  |
|  | - No-Compounding Schedule Propagation (CPM/PERT max-slack resolution)   |  |
|  | - Regression Rollback (Done -> In Progress re-blocks dependents)        |  |
|  | - Critical Path Method (Longest weighted dependency chain)              |  |
|  +-------------------------------------------------------------------------+  |
|  +--------------------------+  +-------------------------------------------+  |
|  | Express REST Controllers |  | Gemini AI Service (Anti-Hallucination)   |  |
|  +--------------------------+  +-------------------------------------------+  |
+-------------------+-----------------------------------+-----------------------+
                    |                                   |
                    v                                   v
+---------------------------------------+   +-----------------------------------+
|      DATABASE (PostgreSQL / Pool)     |   |          GOOGLE GEMINI API        |
|  - tasks                              |   |  - gemini-1.5-flash               |
|  - dependencies                       |   |  - Strict Whitelist Grounding     |
|  - ai_suggestions (pending/accepted)  |   |  - Candidate-bounded suggestions  |
|  - audit_log (propagation timeline)   |   +-----------------------------------+
+---------------------------------------+
```

### Layer Responsibilities & Communications

- **Frontend Layer (React 18 + Vite + Tailwind CSS):** Renders an interactive Kanban board with `@hello-pangea/dnd` and a custom SVG DAG graph viewer. Communicates exclusively with the backend via REST endpoints (`/api/tasks`, `/api/dependencies`, `/api/ai-suggestions`, `/api/critical-path`). It manages local optimistic UI states while enforcing server-authoritative validations via toasts and badges.
- **Backend Service Layer (Node.js + Express.js):** Serves REST API routes, validates payload structures, and coordinates transaction boundaries. Delegates all graph algorithm evaluations to the isolated DAG engine module (`backend/engine/dagEngine.js`).
- **DAG Engine (`backend/engine/dagEngine.js`):** Pure, isolated graph processing module responsible for Depth-First Search (DFS) cycle detection, topological schedule propagation, status cascade management, regression rollback, and Critical Path Method (CPM) calculations.
- **Database Storage Layer (PostgreSQL / File-Backed Snapshot Fallback):** Stores persistent task entities, directed dependency pairs, AI suggestion audit trails, and schedule propagation histories. When PostgreSQL is absent, a file-backed atomic JSON store (`data/taskflow_store.json`) transparently replaces database queries.
- **AI Service Layer (Google Gemini API):** Integrates `@google/generative-ai` (`gemini-1.5-flash`) with strict candidate whitelisting and structured JSON outputs. Provides anti-hallucinated dependency suggestions. Operates with an offline semantic heuristic fallback when API keys are unconfigured.

---

### Request Flow Specifications

#### Flow A: Adding a Dependency (Cycle Check Path)
1. **User Action:** The user selects a prerequisite task in `TaskModal.jsx` and clicks "Add Dependency" (or accepts an AI suggestion).
2. **HTTP Request:** Frontend sends `POST /api/dependencies` with `{ task_id, depends_on_task_id }`.
3. **Validation & Self-Loop Check:** Backend route controller verifies both UUIDs exist and ensures `task_id !== depends_on_task_id`.
4. **Graph Construction & Cycle Tracing:** Backend fetches current dependencies and invokes `dagEngine.detectCycle(tasks, existingDeps, proposedEdge)`.
5. **DFS Evaluation:** A Depth-First Search constructs a temporary graph including the proposed edge and tracks visited nodes using a recursion stack.
6. **Branch Result:**
   - **If Cycle Detected:** Engine returns `{ hasCycle: true, cyclePath: ['Task C', 'Task A', 'Task B', 'Task C'] }`. Controller halts execution and responds with `400 Bad Request` and cycle details. Database is untouched.
   - **If Safe (No Cycle):** Controller inserts edge into `dependencies` table, invokes `dagEngine.recomputeGraphDependencyStatuses()` to update downstream `dependency_status` ('ready' vs 'blocked'), and returns `201 Created`.

#### Flow B: Rescheduling a Task (Propagation Path)
1. **User Action:** The user updates a task's `end_date` in `TaskModal.jsx` and clicks "Propagate Schedule".
2. **HTTP Request:** Frontend issues `POST /api/tasks/:id/propagate-schedule` with `{ new_end_date }`.
3. **Delta & Topological Traversal:** Controller updates target task's `end_date` and calls `dagEngine.propagateSchedule(taskId, newEndDate, tasks, dependencies)`.
4. **No-Compounding Computation:** The engine performs a topological traversal (BFS/Kahn's algorithm) of all descendant tasks. For each descendant $D$, it computes:
   $$\text{earliest\_start} = \max_{P \in \text{prereqs}(D)} (\text{prereq\_end\_date} + 1 \text{ day})$$
   $$\text{new\_end\_date} = \text{earliest\_start} + \text{base\_duration\_days} - 1$$
5. **Diamond Resolution:** For converging paths ($A \to B \to D$ and $A \to C \to D$), $D$ takes the maximum prerequisite finish date rather than adding delays additively.
6. **Persistence & Audit Logging:** Updated dates are saved to the `tasks` table, and entries are appended to `audit_log` with `action = 'schedule_propagation'`. Response returns modified tasks and audit logs.

---

## 2. Data Model

TaskFlow Pro uses four core relational entities defined in `backend/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  column_status TEXT NOT NULL DEFAULT 'backlog', -- backlog | in_progress | review | done
  dependency_status TEXT NOT NULL DEFAULT 'ready', -- ready | blocked
  start_date DATE,
  end_date DATE,
  base_duration_days INT NOT NULL DEFAULT 1, -- original planned duration
  position INT NOT NULL DEFAULT 0, -- order within column
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,       -- downstream task
  depends_on_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, -- upstream prerequisite
  source TEXT NOT NULL DEFAULT 'manual', -- manual | ai_suggested
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS ai_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  suggested_depends_on_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  confidence TEXT, -- e.g. high | medium | low
  rationale TEXT,  -- short explanation from the LLM
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  old_end_date DATE,
  new_end_date DATE,
  triggered_by_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  action TEXT NOT NULL DEFAULT 'schedule_propagation',
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Entity Relationships & Description

- **`tasks`:** Represents individual work units. Tracks Kanban stage (`column_status`), DAG blocking state (`dependency_status`), planned schedule (`start_date`, `end_date`), duration, and ordering.
- **`dependencies`:** Represents directed Finish-to-Start (FS) prerequisite edges. A record (`task_id`, `depends_on_task_id`) specifies that `depends_on_task_id` must reach `done` column status before `task_id` becomes `ready`. Foreign keys maintain cascading deletes.
- **`ai_suggestions`:** Stores candidate dependency pairs generated by Gemini. Relates a target task to a suggested prerequisite task with metadata (`confidence`, `rationale`, `status`). It remains isolated from active graph computations until explicitly accepted.
- **`audit_log`:** Provides an immutable change log for automated schedule shift operations. Each entry links the affected `task_id` to the `triggered_by_task_id` ancestor that initiated the propagation.

---

## 3. Known Limitations

1. **Persistence Mode Differences:**
   - **PostgreSQL Mode:** Enforces transactional integrity (`BEGIN`/`COMMIT`/`ROLLBACK`) and foreign key cascades.
   - **File-Backed JSON Snapshot Fallback (`data/taskflow_store.json`):** When `DATABASE_URL` is omitted, data is persisted to a local JSON file. While atomic file writes (`fs.writeFileSync`) ensure persistence across server restarts, high-concurrency write operations could experience file lock contention.
2. **Multi-Tenancy & Project Partitioning:**
   - The current schema operates as a single-tenant system without a `project_id` or `workspace_id` partition key. All tasks belong to one global DAG space. In multi-team environments, graph algorithms must be scoped by adding a `project_id` foreign key.
3. **Graph Computation Performance Ceiling:**
   - Graph algorithms (DFS cycle check, Kahn's topological propagation, Critical Path) execute in $O(V + E)$ time in-memory. For graphs under ~10,000 nodes, recomputation completes in under 5ms. However, for extremely large graphs (>100,000 nodes), synchronous in-memory graph loading and traversal per request would introduce CPU latency, requiring background queue processing (e.g., BullMQ / Redis) or graph caching.
4. **Discrete Day Granularity:**
   - Date propagation assumes whole calendar days (`YYYY-MM-DD`) with a minimum 1-day prerequisite finish buffer. Working days, holidays, weekends, and sub-day hourly schedules are out of scope.
5. **Single Constraint Type:**
   - Supports only Finish-to-Start (FS) dependency relationships. Start-to-Start (SS), Finish-to-Finish (FF), and lead/lag offsets are not currently supported.
