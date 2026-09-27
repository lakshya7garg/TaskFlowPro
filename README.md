# TaskFlow Pro

TaskFlow Pro is a dependency-aware project and workflow management platform featuring a high-precision Directed Acyclic Graph (DAG) engine behind an interactive Kanban board and SVG DAG visualizer. It manages prerequisite chains, performs cycle detection with path reporting, calculates non-compounding schedule propagation across converging paths (diamond dependencies), enforces downstream blocking and rollback cascade, and provides AI-augmented dependency suggestions powered by the Google Gemini API with anti-hallucination grounding.

---

## Architecture

TaskFlow Pro follows a clean, decoupled client-server architecture with an isolated, unit-tested DAG engine:

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

### Data & Workflow Flow:
1. **Dependency Addition & Cycle Detection:** When a dependency edge is proposed, `dagEngine.detectCycle()` executes a DFS cycle detection algorithm server-side before any write occurs. If a circular dependency is detected, the request is rejected with a `400` status and a descriptive cycle path (e.g. `Task C → Task A → Task B → Task C`), leaving the database completely unchanged.
2. **Status Cascades & Rollback:** When a task transitions columns, `dagEngine.recomputeGraphDependencyStatuses()` traverses all downstream dependents. If an upstream task moves from `Done` back to `In Progress`, all direct and transitive dependents immediately re-block.
3. **No-Compounding Rescheduling:** When an upstream deadline extends by $N$ days, `dagEngine.propagateSchedule()` topologically traverses downstream descendants and applies $\max(\text{current\_start}, \max_{P}(\text{prereq\_end} + \text{gap}))$. This guarantees converging diamond graphs ($A \to B \to D$ and $A \to C \to D$) shift dependent $D$ by $N$ days once, rather than compounding additively to $2N$.
4. **AI-Augmented Dependency Suggestion:** Target tasks and candidate existing tasks are evaluated by Google Gemini with strict grounding checks. Suggestions are stored as `pending` and must be explicitly accepted by the user, passing through the DAG cycle check upon acceptance.

---

## Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS, `@hello-pangea/dnd` (drag-and-drop), `lucide-react` (icons).
- **Backend:** Node.js, Express.js.
- **Database:** PostgreSQL (`pg` connection pool) with full DDL schema and file-persisted zero-config local storage (`data/taskflow_store.json`) for turnkey standalone evaluation.
- **AI/LLM:** Google Gemini API (`@google/generative-ai` / `gemini-1.5-flash`) with heuristic fallback for offline testing.
- **Testing:** Jest (ESM modules) and Supertest for DAG Engine unit and API integration testing.

---

## Setup & Run Instructions

### Prerequisites
- Node.js (v18+ or v20+)
- npm (v9+)
- (Optional) PostgreSQL database instance. If not provided, TaskFlow Pro runs in local file-persisted mode out-of-the-box.

### 1. Environment Variables
Create a `.env` file in the root or `backend/` directory by copying `.env.example`:

```bash
# Copy example environment configuration
cp .env.example .env
```

Set the following variables in `.env`:
```env
PORT=5000
DATABASE_URL=postgres://username:password@localhost:5432/taskflowpro
GEMINI_API_KEY=your_gemini_api_key_here
```

### 2. Backend Installation & Run
```bash
cd backend
npm install
npm run dev
```
Backend runs on `http://localhost:5000`.

### 3. Frontend Installation & Run
```bash
cd frontend
npm install
npm run dev
```
Frontend runs on `http://localhost:5173` (with proxy to port 5000 configured).

### 4. Database Migration & Seed
To run database migrations or re-seed the demo dataset:
```bash
# In backend directory
npm run migrate
npm run seed
```
Or click the **"Reset Demo Data"** button directly in the web UI header at any time.

---

## How to Verify Hard Requirements Yourself (5-Minute Judge Guide)

Follow these quick manual verification steps to evaluate the core DAG engine:

### 1. Verify Cycle Detection Rejection
- Open the task **"Design DB Schema & System Architecture"** (Task 1).
- Go to the **"DAG Dependencies"** tab.
- Try adding **"Integrate Frontend with Backend API"** (Task 4) as a prerequisite to Task 1.
- **Expected result:** Immediate rejection toast with the exact cycle path: `Cannot add dependency: would create a cycle Integrate Frontend with Backend API → Design DB Schema & System Architecture → ...`. The database remains unchanged.

### 2. Verify No-Compounding Diamond Rescheduling
- The seed dataset contains a diamond: `T1 (Schema)` $\to$ `T2 (API)` & `T3 (UI)` $\to$ `T4 (Integration)`.
- Open **T1**, extend its **End Date** by $+3$ days (e.g., to `2026-10-06`), and click **"Propagate Schedule"**.
- Open the **Audit Log** modal (history icon in navbar).
- **Expected result:** `T2` and `T3` shift by $+3$ days, and `T4` shifts by **exactly $+3$ days** (to `2026-10-11`), **NOT compounded $+6$ days**.

### 3. Verify Rollback on Regression (Done $\to$ In Progress)
- Move **T2** and **T3** to the **Done** column.
- Notice **T4** immediately unblocks and turns **Ready** (green badge).
- Drag **T2** backwards from **Done** to **In Progress**.
- **Expected result:** **T4** immediately flips back to **Blocked** (red badge).

### 4. Verify Blocked Task Movement Prevention
- Try dragging a **Blocked** task (e.g. `T4`) into **In Progress**, **Review**, or **Done**.
- **Expected result:** The move is rejected and snaps back, showing a toast explaining which prerequisite tasks are unmet.

### 5. Verify Grounded Gemini AI Suggestions
- Open **T4**, navigate to the **"AI Suggestions"** tab, and click **"Suggest Dependencies"**.
- **Expected result:** Grounded suggestions appear with confidence scores and rationale. Accepting a suggestion validates it against the DFS cycle engine.

---

## AI-Tool Declaration

Per hackathon guidelines:
- **Claude & Antigravity (Google DeepMind):** Used for code scaffolding, DAG algorithm unit and integration test structuring, and README synopsis polishing.

---

## AI/LLM Feature: Dependency Suggestion

The AI dependency suggestion feature (`POST /api/ai-suggestions/generate` and `TaskModal.jsx`) leverages Google Gemini to analyze task semantics and propose prerequisite relationships.

### Grounding & Anti-Hallucination Measures
1. **Strict Candidate Whitelist:** The backend sends only existing candidate task objects (`id`, `title`, `description`) to Gemini. Any returned task ID that is not in the whitelist is discarded.
2. **Self-Loop & Duplicate Prevention:** Discards self-referential suggestions (`task_id === depends_on_task_id`) and existing prerequisite edges.
3. **Structured JSON Enforcement:** Gemini is prompted with `responseMimeType: 'application/json'` and instructed to return `[]` when uncertain.
4. **Mandatory Human-in-the-Loop:** Suggestions are stored as `status = 'pending'`. No suggestion is ever automatically converted into a live dependency.
5. **Cycle Detection on Acceptance:** Clicking "Accept & Link Edge" executes server-side DFS cycle detection (`POST /api/dependencies`). Circular suggestions are rejected.
6. **Rejection Auditing:** Rejected suggestions are marked `status = 'rejected'` for auditability.

---

## Key Assumptions and Limitations

1. **Persistence Modes:**
   - When `DATABASE_URL` is set, TaskFlow Pro uses PostgreSQL with full relational integrity and transactions.
   - When `DATABASE_URL` is omitted, TaskFlow Pro uses a file-backed local store (`data/taskflow_store.json`) ensuring state persistence across backend server restarts without external database setup.
2. **Discrete Day Scheduling:** Task dates use calendar days (`YYYY-MM-DD`). Schedule propagation enforces a 1-day buffer (`earliest_start = prerequisite_end_date + 1 day`).
3. **Single Dependency Type:** Dependencies represent Finish-to-Start (FS) constraints (`depends_on_task_id` must finish before `task_id` can start).
4. **Offline Heuristic Fallback:** If `GEMINI_API_KEY` is not provided, the system seamlessly uses an intelligent semantic heuristic engine.

---

## Business Impact & Scalability

### Database Indexing Strategy
For enterprise production deployments with thousands of tasks, the following indexes are provided:
```sql
CREATE INDEX idx_tasks_column_status ON tasks(column_status);
CREATE INDEX idx_tasks_dependency_status ON tasks(dependency_status);
CREATE INDEX idx_dependencies_task_id ON dependencies(task_id);
CREATE INDEX idx_dependencies_depends_on ON dependencies(depends_on_task_id);
CREATE UNIQUE INDEX idx_dependencies_pair ON dependencies(task_id, depends_on_task_id);
CREATE INDEX idx_audit_log_task_id ON audit_log(task_id);
```

### Computational Complexity
- **Cycle Detection:** $O(V + E)$ where $V = |\text{Tasks}|$ and $E = |\text{Dependencies}|$. Uses DFS with a recursion stack.
- **Topological Schedule Propagation:** $O(V + E)$ using Kahn's algorithm / BFS in-degree tracking across descendants.
- **Status Cascade:** $O(V + E)$ bounded topological re-evaluation.
- **Critical Path Calculation:** $O(V + E)$ longest path DAG traversal.

### Multi-Project Partitioning
To scale horizontally across teams, tables can be partitioned with a `project_id UUID REFERENCES projects(id)` column, isolating DAG graph computations to the active project subgraph.

---

## Testing

TaskFlow Pro includes both isolated unit tests for the DAG engine and full HTTP integration tests for the Express REST API.

### Running Tests
```bash
# In backend directory
npm test
```

### Test Suite Coverage (25 Passing Tests)
- **Unit Tests (`backend/tests/dagEngine.test.js`):**
  - Self-loop rejection (`A -> A`)
  - 2-node cycle rejection (`A -> B -> A`) with path reporting
  - 3-node cycle rejection (`A -> B -> C -> A`) with path reporting
  - Valid DAG edge addition allowed
  - Standalone task `ready` state
  - Prerequisite incomplete $\to$ `blocked` state
  - All prerequisites completed $\to$ `ready` transition
  - Downstream cascade upon prerequisite completion
  - 3-level chain dependency cascade ($A \to B \to C$)
  - **Diamond convergence test (no compounding delay):** $A (+3\text{d}) \to B, C \to D$ shifted by $+3\text{d}$, not $+6\text{d}$
  - Deep 4-level propagation ($A \to B \to D \to F$ and $A \to C \to D \to F$)
  - **Rollback on regression:** `Done` $\to$ `In Progress` re-blocks dependents
  - Critical path calculation on diamond graph
- **Integration Tests (`backend/tests/apiIntegration.test.js`):**
  - Health check endpoint
  - Tasks CRUD and input validation (rejects missing title with 400)
  - Dependency creation and cycle rejection via HTTP
  - Drag-and-drop movement and blocked task prevention via HTTP
  - Schedule propagation via HTTP
  - AI suggestion generation, acceptance, and rejection workflow

---

## Critical Path View

TaskFlow Pro includes a built-in **Critical Path Method (CPM)** engine:
- Computes the longest dependency chain by cumulative base duration from source tasks to terminal tasks.
- Toggle the **"Critical Path"** button in the top navigation bar to highlight the critical chain in amber across both the Kanban board cards and the interactive SVG DAG Visualizer.
- Displays the total critical path duration (e.g. `15d`).

---

## Demo Seed Data

The application includes 9 seeded tasks with realistic dependencies and a diamond convergence:
1. **T1:** `Design DB Schema & System Architecture` (Done, 3d)
2. **T2:** `Implement Core REST API & Auth Module` (In Progress, 4d, depends on T1)
3. **T3:** `Develop UI Components & Theme System` (In Progress, 4d, depends on T1)
4. **T4:** `Integrate Frontend with Backend API` (Backlog, 3d, depends on T2 & T3) — **Diamond Convergence**
5. **T5:** `Setup CI/CD Pipeline & Docker` (Done, 2d)
6. **T6:** `Execute Automated Integration & E2E Tests` (Backlog, 2d, depends on T4 & T5)
7. **T7:** `Performance Optimization & Load Testing` (Backlog, 2d, depends on T6)
8. **T8:** `Security Audit & Vulnerability Assessment` (Backlog, 2d, depends on T6)
9. **T9:** `Production Deployment & Demo Presentation` (Backlog, 1d, depends on T7 & T8)
