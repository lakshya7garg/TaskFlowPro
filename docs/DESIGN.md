# TaskFlow Pro — System Design & Architecture Document

This document provides a comprehensive technical design and architectural overview of **TaskFlow Pro**, a dependency-aware project management platform featuring an isolated Directed Acyclic Graph (DAG) engine, Kanban orchestration, and anti-hallucinatory AI dependency suggestions.

---

## 1. Architecture Overview

TaskFlow Pro is architected with clear separation of concerns, decoupling graph computation from persistence and transport layers.

```
+-------------------------------------------------------------------------------+
|                               FRONTEND (React 18 + Vite)                      |
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
|  | Isolated Pure-JS DAG Engine (backend/engine/dagEngine.js)               |  |
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

### Why This Architecture?

1. **Isolated Pure-JS DAG Engine:** Rather than embedding graph algorithms into route handlers or stored database procedures, all graph logic resides in an isolated, dependency-free JavaScript module (`backend/engine/dagEngine.js`). This guarantees:
   - **Deterministic Testing:** Graph algorithms can be unit tested with 100% isolation in milliseconds without initializing database fixtures or mock servers.
   - **Database Agnosticism:** The engine operates on standard in-memory arrays of nodes and edges, allowing seamless transitions between PostgreSQL and fallback file storage without altering algorithm code.
   - **Algorithmic Correctness:** Cycle detection, Critical Path Method (CPM), and topological propagation run synchronously in memory with zero intermediate I/O side effects.
2. **RESTful API Design:** REST was chosen over GraphQL or WebSockets for simplicity, strict idempotency semantics, standard HTTP status codes (`400 Bad Request` with cycle path payloads), and minimal overhead during evaluation and testing.
3. **Transparent File-Backed Fallback:** When `DATABASE_URL` is omitted, the storage layer automatically falls back to an atomic JSON file store (`data/taskflow_store.json`). This ensures zero-friction evaluation, instant onboarding for reviewers, and isolated local development without local PostgreSQL setup.

---

### REST API Endpoints

The backend exposes a comprehensive set of REST endpoints across task management, graph operations, AI suggestions, and operational observability:

| Method | Endpoint | Purpose / Description |
| :--- | :--- | :--- |
| `GET` | `/api/tasks` | List all tasks with enriched prerequisite and dependent task details, with fresh computed dependency statuses (`ready` vs `blocked`). |
| `POST` | `/api/tasks` | Create a new task in `backlog` with input validation and default `ready` status. |
| `PATCH` | `/api/tasks/:id` | Update task fields (title, description, dates, position) and trigger graph status cascade if column changes. |
| `POST` | `/api/tasks/:id/move` | Move task across Kanban columns (`backlog`, `in_progress`, `review`, `done`), enforcing blocking rules and triggering downstream DAG cascades. |
| `POST` | `/api/tasks/:id/reschedule` | Reschedule task end date and execute no-compounding topological schedule propagation across all downstream tasks. |
| `DELETE` | `/api/tasks/:id` | Delete task, cascade-remove its dependencies, and recompute remaining graph dependency statuses. |
| `GET` | `/api/tasks/:id/dependencies` | Fetch all direct prerequisite tasks and dependency metadata for a specific task. |
| `POST` | `/api/dependencies` | Add a directed dependency edge after passing DFS cycle detection; triggers downstream status cascades. |
| `DELETE` | `/api/dependencies/:id` | Remove a dependency edge and recompute downstream task blocking statuses. |
| `GET` | `/api/ai-suggestions/status` | Check operational mode of AI service (`live` Google Gemini API vs `offline` heuristic fallback). |
| `GET` | `/api/tasks/:id/ai-suggestions` | List all AI-generated dependency suggestions (pending, accepted, rejected) for a specific task. |
| `POST` | `/api/ai-suggestions/generate` | Generate grounded candidate dependency suggestions using Gemini 1.5 Flash (or semantic fallback) with IP rate limiting. |
| `POST` | `/api/ai-suggestions/:id/accept` | Accept an AI suggestion: runs DFS cycle check, persists dependency edge, updates suggestion status to `accepted`, and cascades graph statuses. |
| `POST` | `/api/ai-suggestions/:id/reject` | Mark an AI suggestion as `rejected`. |
| `GET` | `/api/critical-path` | Calculate and return the longest weighted dependency chain and total project duration (Critical Path Method). |
| `GET` | `/api/audit-logs` | Retrieve the 50 most recent schedule propagation audit events with task title attribution. |
| `POST` | `/api/seed/reset` | Reset the database to the canonical 6-task demo graph state. |
| `GET` | `/api/health` | Health check endpoint returning uptime status, timestamp, and active database mode (`postgres` vs `json`). |

---

### Detailed Sequence Diagrams & Request Flows

#### Flow 1: Adding a Dependency (Cycle Detection Path)
1. **User Action:** The user selects a prerequisite task in `TaskModal.jsx` and clicks "Add Dependency" (or clicks "Accept" on an AI suggestion).
2. **HTTP Request:** Frontend issues `POST /api/dependencies` with payload `{ task_id, depends_on_task_id, source }`.
3. **Input Validation:** Controller verifies both UUIDs are valid, distinct (`task_id !== depends_on_task_id`), and that both tasks exist in the database.
4. **Duplicate Edge Check:** Controller verifies the dependency does not already exist in the database.
5. **DFS Cycle Traversal:** Controller invokes `dagEngine.detectCycle(tasks, existingDeps, proposedEdge)`:
   - Constructs a temporary adjacency list containing the proposed edge.
   - Performs a Depth-First Search with a recursion stack tracking active paths.
6. **Cycle Evaluation Branch:**
   - **If Cycle Detected (`hasCycle === true`):** Execution halts immediately. Controller returns `400 Bad Request` with `{ cycleDetected: true, cyclePath: [...] }`. No database records are written.
   - **If Safe (`hasCycle === false`):** Controller inserts the edge into `dependencies`, calls `dagEngine.recomputeGraphDependencyStatuses()`, updates affected tasks in the database, and returns `201 Created`.
7. **Frontend Sync:** React receives the response, updates the task modal, refreshes Kanban cards with updated `BLOCKED` badges, and redraws the SVG DAG.

#### Flow 2: Rescheduling a Task (No-Compounding Propagation Path)
1. **User Action:** The user adjusts a task's `end_date` in `TaskModal.jsx` and clicks "Propagate Schedule".
2. **HTTP Request:** Frontend issues `POST /api/tasks/:id/reschedule` with `{ start_date, end_date, buffer_days }`.
3. **Topological Propagation Computation:** Backend passes the updated dates to `dagEngine.propagateSchedule(...)`:
   - Builds downstream adjacency list from the changed task.
   - Uses Kahn's topological sort / BFS queue to visit descendants in topological order.
   - For each descendant $D$, computes:
     $$\text{earliest\_start} = \max_{P \in \text{prereqs}(D)} (\text{end\_date}(P) + \text{buffer\_days})$$
     $$\text{new\_end\_date} = \text{earliest\_start} + \text{base\_duration\_days}(D) - 1$$
   - **Diamond Resolution:** For diamond patterns ($A \to B \to D$ and $A \to C \to D$), $D$ aligns to $\max(\text{end}(B), \text{end}(C)) + 1$, preventing additive delay compounding.
4. **Database Persistence:** Updated dates for all affected downstream tasks are saved to `tasks`.
5. **Audit Trail Logging:** An entry is inserted into `audit_log` for every shifted task, recording `old_end_date`, `new_end_date`, and `triggered_by_task_id`.
6. **Response & UI Refresh:** Backend returns `{ success: true, propagatedTasks, auditLogs }`. Frontend updates local task store and displays a propagation toast summary.

#### Flow 3: Moving a Task Between Kanban Columns (Blocking Enforcement & Status Cascade Path)
1. **User Action:** User drags a task card from `Backlog` to `In Progress` (or calls `POST /api/tasks/:id/move`).
2. **HTTP Request:** Frontend sends `POST /api/tasks/:id/move` with `{ column_status: 'in_progress', position }`.
3. **Blocking Rule Check:**
   - Backend evaluates `currentTask.dependency_status`.
   - **If `dependency_status === 'blocked'`:** Controller queries unmet prerequisites and rejects the transition with `400 Bad Request` and message listing incomplete prerequisite titles. The card reverts to its previous column.
   - **If `dependency_status === 'ready'`:** Controller updates `column_status` and `position` in `tasks`.
4. **Downstream Cascade Recomputation:**
   - If the task moved to `done`, downstream tasks with all prerequisites satisfied transition from `blocked` to `ready`.
   - **Regression Rollback:** If a task moved backwards from `done` to `in_progress` or `backlog`, `dagEngine.recomputeGraphDependencyStatuses` automatically re-blocks all downstream direct and transitive dependents.
5. **Persistence & Response:** Updated task statuses are saved to the database, and `200 OK` is returned with `cascadeUpdatedTasks`.

#### Flow 4: Generating and Accepting AI Suggestions (Anti-Hallucination & Promotion Path)
1. **User Action:** User opens `TaskModal.jsx` and clicks "Suggest Dependencies" (or clicks the AI sparkle badge).
2. **HTTP Request:** Frontend sends `POST /api/ai-suggestions/generate` with `{ task_id }`.
3. **Rate Limiting & Candidate Whitelist:** Backend validates rate limits (max 20 req/min/IP), pulls all tasks, and constructs a strict candidate whitelist (excluding target task and existing prerequisites).
4. **Gemini 1.5 Flash Prompting:** `geminiService.js` sends structured system prompt with task titles, descriptions, and candidate IDs. If API is unavailable, semantic heuristic analyzer executes.
5. **Anti-Hallucination Filtering:** Backend validates that every returned candidate ID exists in the candidate whitelist, discarding hallucinations or existing dependencies.
6. **Persistence:** Valid suggestions are stored in `ai_suggestions` with `status = 'pending'`.
7. **Acceptance Promotion:** When user clicks "Accept", `POST /api/ai-suggestions/:id/accept` runs DFS cycle verification. If acyclic, edge is inserted into `dependencies` with `source = 'ai_suggested'`, suggestion status becomes `accepted`, and graph statuses cascade.

---

### Deployment Topology

- **Monorepo Layout:** Clean root directory containing `frontend/` (React SPA) and `backend/` (Express API).
- **Development Topology:**
  - Frontend runs on Vite dev server (`http://localhost:5173`) with proxy configuration in `vite.config.js` forwarding `/api/*` requests to `http://localhost:5000`.
  - Backend runs Node.js (`http://localhost:5000`) with auto-reload.
- **Production Topology:**
  - Frontend compiles to static assets (`frontend/dist`).
  - Backend can serve static bundle directly or sit behind a reverse proxy (NGINX/Caddy/Cloudflare) routing `/api/*` to Node.js and static assets to CDN.

---

## 2. Data Model

TaskFlow Pro utilizes four core relational entities defined in `backend/db/schema.sql`:

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
  confidence TEXT, -- high | medium | low
  rationale TEXT,  -- LLM reasoning
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

### Table Specifications

#### 1. `tasks` Table
| Column Name | Data Type | Constraints | Meaning / Purpose |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY`, Default `gen_random_uuid()` | Unique immutable task identifier. |
| `title` | `TEXT` | `NOT NULL` | Human-readable title of the task. |
| `description` | `TEXT` | Nullable | Detailed scope, context, or requirements for the task. |
| `column_status` | `TEXT` | `NOT NULL`, Default `'backlog'` | Current Kanban column stage: `backlog`, `in_progress`, `review`, `done`. |
| `dependency_status` | `TEXT` | `NOT NULL`, Default `'ready'` | DAG blocking state: `ready` (all prerequisites done) or `blocked` (unmet prerequisite). |
| `start_date` | `DATE` | Nullable | Planned start date (`YYYY-MM-DD`). |
| `end_date` | `DATE` | Nullable | Planned completion date (`YYYY-MM-DD`). |
| `base_duration_days` | `INT` | `NOT NULL`, Default `1` | Inherent task span in days; preserved during schedule shifts. |
| `position` | `INT` | `NOT NULL`, Default `0` | Vertical sorting index within a Kanban column. |
| `created_at` | `TIMESTAMPTZ` | Default `now()` | Timestamp when task was created. |
| `updated_at` | `TIMESTAMPTZ` | Default `now()` | Timestamp when task was last modified. |

#### 2. `dependencies` Table
| Column Name | Data Type | Constraints | Meaning / Purpose |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY`, Default `gen_random_uuid()` | Unique dependency edge identifier. |
| `task_id` | `UUID` | `NOT NULL`, `REFERENCES tasks(id) ON DELETE CASCADE` | Downstream task that requires completion of the prerequisite. |
| `depends_on_task_id` | `UUID` | `NOT NULL`, `REFERENCES tasks(id) ON DELETE CASCADE` | Upstream prerequisite task that must be `done`. |
| `source` | `TEXT` | `NOT NULL`, Default `'manual'` | Origin of dependency: `'manual'` or `'ai_suggested'`. |
| `created_at` | `TIMESTAMPTZ` | Default `now()` | Timestamp when edge was created. |

*Constraint:* `UNIQUE (task_id, depends_on_task_id)` guarantees at most one directed edge exists between any two tasks.

#### 3. `ai_suggestions` Table
| Column Name | Data Type | Constraints | Meaning / Purpose |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY`, Default `gen_random_uuid()` | Unique AI suggestion identifier. |
| `task_id` | `UUID` | `NOT NULL`, `REFERENCES tasks(id) ON DELETE CASCADE` | Target downstream task for which suggestion was generated. |
| `suggested_depends_on_task_id` | `UUID` | `NOT NULL`, `REFERENCES tasks(id) ON DELETE CASCADE` | Proposed upstream prerequisite task. |
| `confidence` | `TEXT` | Nullable (`'high'`, `'medium'`, `'low'`) | AI model confidence score. |
| `rationale` | `TEXT` | Nullable | AI explanation justifying the dependency. |
| `status` | `TEXT` | `NOT NULL`, Default `'pending'` | Review state: `'pending'`, `'accepted'`, or `'rejected'`. |
| `created_at` | `TIMESTAMPTZ` | Default `now()` | Timestamp when suggestion was generated. |

#### 4. `audit_log` Table
| Column Name | Data Type | Constraints | Meaning / Purpose |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY`, Default `gen_random_uuid()` | Unique audit record identifier. |
| `task_id` | `UUID` | `NOT NULL`, `REFERENCES tasks(id) ON DELETE CASCADE` | The descendant task whose schedule was shifted. |
| `old_end_date` | `DATE` | Nullable | Task end date before propagation. |
| `new_end_date` | `DATE` | Nullable | Task end date after propagation. |
| `triggered_by_task_id` | `UUID` | Nullable, `REFERENCES tasks(id) ON DELETE SET NULL` | The ancestor task whose reschedule triggered the cascade. |
| `action` | `TEXT` | `NOT NULL`, Default `'schedule_propagation'` | Type of automated action executed. |
| `details` | `TEXT` | Nullable | Human-readable explanation of the schedule shift. |
| `created_at` | `TIMESTAMPTZ` | Default `now()` | Timestamp when propagation occurred. |

---

### Foreign Key Cascading Behavior

| Foreign Key Constraint | Parent Table | Child Table | On Delete Action | Technical Rationale |
| :--- | :--- | :--- | :--- | :--- |
| `dependencies.task_id` $\to$ `tasks.id` | `tasks` | `dependencies` | `CASCADE` | Deleting a downstream task removes all its incoming prerequisite requirements. |
| `dependencies.depends_on_task_id` $\to$ `tasks.id` | `tasks` | `dependencies` | `CASCADE` | Deleting an upstream task removes prerequisite constraints so dependents are unblocked. |
| `ai_suggestions.task_id` $\to$ `tasks.id` | `tasks` | `ai_suggestions` | `CASCADE` | Suggestions for a deleted task are no longer relevant. |
| `ai_suggestions.suggested_depends_on_task_id` $\to$ `tasks.id` | `tasks` | `ai_suggestions` | `CASCADE` | Suggestions referencing a deleted prerequisite become invalid. |
| `audit_log.task_id` $\to$ `tasks.id` | `tasks` | `audit_log` | `CASCADE` | Historical shifts for a deleted task are removed to maintain referential hygiene. |
| `audit_log.triggered_by_task_id` $\to$ `tasks.id` | `tasks` | `audit_log` | `SET NULL` | Preserves audit record even if the originating ancestor task is later deleted. |

---

### Database Indexes & Performance Justifications

1. **`dependencies(task_id, depends_on_task_id)` UNIQUE:**
   - *Purpose:* Prevents duplicate edges and creates a composite B-tree index enabling $O(\log N)$ adjacency lookups for cycle checks.
2. **`dependencies(task_id)` and `dependencies(depends_on_task_id)`:**
   - *Purpose:* Accelerates incoming and outgoing edge lookups during in-memory graph reconstruction and topological cascades.
3. **`tasks(column_status)` & `tasks(dependency_status)`:**
   - *Purpose:* Optimizes Kanban column rendering and fast filtering of blocked tasks.
4. **`ai_suggestions(task_id, status)`:**
   - *Purpose:* Accelerates fetching active pending suggestions inside the task modal.
5. **`audit_log(created_at DESC)`:**
   - *Purpose:* Powers fast descending pagination for the schedule propagation audit timeline modal.

---

## 3. Known Limitations & Future Roadmap

| Limitation | Severity | Description | Proposed Future Fix |
| :--- | :---: | :--- | :--- |
| **Optimistic Concurrency Control** | `[Medium]` | Simultaneous edits across two browser tabs can overwrite schedules if tab state is stale. | Add an `updated_at` / version timestamp check on writes with WebSocket change broadcasting. |
| **Deep Call Stack Recursion** | `[Low]` | Synchronous DFS cycle detection on artificial linear chains exceeding ~10,000 nodes risks stack overflow. | Refactor DFS recursion into an explicit iterative heap-allocated stack traversal. |
| **Calendar-Day Date Granularity** | `[Low]` | Date math operates on whole calendar days ($N + 1$) without skipping weekends or company holidays. | Introduce configurable organizational work-calendar tables with holiday exclusion logic. |
| **Single-Tenant Graph Scope** | `[Medium]` | All tasks exist in a global workspace without multi-tenancy partitioning. | Add `project_id` / `workspace_id` foreign keys to isolate graphs and queries per project. |
| **Dependency Constraint Modes** | `[Low]` | Only Finish-to-Start (FS) constraints are currently supported. | Expand dependency engine to support Start-to-Start (SS), Finish-to-Finish (FF), and lead/lag day offsets. |
| **File-Store Concurrency Ceiling** | `[Low]` | Under the JSON file fallback mode, high-throughput parallel writes may encounter file lock contention. | Use PostgreSQL in high-concurrency production deployments. |
