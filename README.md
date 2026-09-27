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
1. **Dependency Addition & Modification:** When an edge is proposed, `dagEngine.detectCycle()` executes a DFS cycle detection algorithm before any database persistence occurs. If a circular dependency is detected, the transaction is rejected and returns a descriptive path error (e.g. `A → B → C → A`).
2. **Status Cascades & Rollback:** When a task transitions columns, `dagEngine.recomputeGraphDependencyStatuses()` traverses all downstream dependents. If an upstream task moves from `Done` back to `In Progress`, all direct and indirect dependents immediately re-block.
3. **No-Compounding Rescheduling:** When an upstream deadline extends by $N$ days, `dagEngine.propagateSchedule()` topologically traverses downstream descendants and applies $\max(\text{current\_start}, \max_{P}(\text{prereq\_end} + \text{gap}))$. This guarantees converging diamond graphs ($A \to B \to D$ and $A \to C \to D$) shift dependent $D$ by $N$ days once, rather than compounding additively to $2N$.
4. **AI-Augmented Dependency Suggestion:** On demand, the target task along with candidate existing tasks are evaluated by Google Gemini with strict grounding checks. Suggestions are stored as `pending` and must be explicitly accepted by the user, running through the same DAG cycle check.

---

## Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS, `@hello-pangea/dnd` (drag-and-drop), `lucide-react` (icons).
- **Backend:** Node.js, Express.js.
- **Database:** PostgreSQL (`pg` connection pool) with full DDL schema and zero-config in-memory fallback for local development.
- **AI/LLM:** Google Gemini API (`@google/generative-ai` / `gemini-1.5-flash`).
- **Testing:** Jest (ESM modules) for DAG Engine unit testing.

---

## Setup & Run Instructions

### Prerequisites
- Node.js (v18+ or v20+)
- npm (v9+)
- (Optional) PostgreSQL database instance. If not provided, TaskFlow Pro runs in memory mode out-of-the-box.

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
> **Note:** If `DATABASE_URL` is omitted, the app starts with its in-memory PostgreSQL-compatible store. If `GEMINI_API_KEY` is omitted, intelligent rule-based semantic heuristic suggestions are used for offline testing.

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
Or use the **"Reset Demo Data"** button directly in the web UI header at any time.

---

## AI-Tool Declaration

Per hackathon guidelines, AI tools were utilized during development:
- **Claude & Antigravity (Google DeepMind):** Used for code scaffolding, DAG algorithm unit test structuring, and README synopsis polishing.

---

## AI/LLM Feature: Dependency Suggestion

The AI dependency suggestion feature (`POST /api/ai-suggestions/generate` and `TaskModal.jsx`) leverages Google Gemini to analyze task semantics and propose prerequisite relationships.

### Grounding & Anti-Hallucination Measures
To guarantee reliability and prevent hallucinated dependencies:
1. **Strict Candidate Whitelist:** The system only sends real existing task records (`id`, `title`, `description`) to Gemini. Returned task IDs are verified against active task IDs in PostgreSQL; any unknown ID is discarded.
2. **Self-Loop & Duplicate Prevention:** The service eliminates self-referential suggestions (`task_id === depends_on_task_id`) and drops existing prerequisite edges prior to prompt creation.
3. **Structured JSON Enforcement:** The model is instructed to return only RFC 8259 JSON with `depends_on_task_id`, `confidence` (`high` | `medium` | `low`), and a one-sentence `rationale`. When uncertain, it is instructed to return `[]`.
4. **Mandatory Human-in-the-Loop:** Suggestions are stored with `status = 'pending'`. **No suggestion is ever automatically converted into a live dependency.**
5. **Cycle Detection on Acceptance:** When the user clicks "Accept & Link Edge", the proposed dependency edge passes through the exact same DFS cycle detection engine as manual edges (`POST /api/dependencies`). If accepting the suggestion would create a cycle, the promotion is rejected and flagged to the user.
6. **Rejection Auditing:** Rejected suggestions are recorded (`status = 'rejected'`) for auditability.

---

## Key Assumptions and Limitations

1. **Discrete Day Scheduling:** Task dates use calendar days (`YYYY-MM-DD`). Schedule propagation enforces a 1-day buffer (`earliest_start = prerequisite_end_date + 1 day`).
2. **Single Dependency Type:** Dependencies represent Finish-to-Start (FS) constraints (`depends_on_task_id` must finish before `task_id` can start).
3. **Optimistic UI with Server Validation:** The Kanban board performs optimistic UI movements while verifying with the server DAG engine. Blocked tasks dragged to active columns trigger an immediate rollback with an explanation toast.
4. **Offline Heuristic Fallback:** If `GEMINI_API_KEY` is not provided or quota is exceeded, the system employs an intelligent keyword and semantic heuristic engine to maintain full demo capabilities.

---

## Testing

The core DAG engine is implemented as an isolated, unit-tested module in `backend/engine/dagEngine.js` with comprehensive test coverage in `backend/tests/dagEngine.test.js`.

### Running Tests
```bash
# In the root directory or backend directory
cd backend
npm test
```

### Test Suite Coverage
- `3.1 Cycle Detection`:
  - Direct self-loop rejection (`A -> A`)
  - 2-node cycle rejection (`A -> B -> A`) with path reporting
  - 3-node cycle rejection (`A -> B -> C -> A`) with path reporting
  - Valid DAG edge addition allowed
- `3.2 Blocked / Ready Status Computation`:
  - Standalone task starts in `ready` state
  - Task becomes `blocked` when any prerequisite is not `done`
  - Task transitions to `ready` when all prerequisites reach `done`
  - Downstream cascading across multi-tier dependencies
- `3.3 No-Compounding Schedule Propagation (Diamond Convergence Test)`:
  - Exact diamond graph from specification ($A \to B \to D$ and $A \to C \to D$)
  - Task $A$ delay of $+3$ days shifts $B$ and $C$ by $+3$ days
  - Verifies that task $D$ shifts by **exactly $+3$ days**, NOT compounded $+6$ days
  - Audit log event emission verified
- `3.4 Rollback on Regression`:
  - Prerequisite moving backwards from `done` to `in_progress` causes downstream tasks to re-block
- `Critical Path Calculation`:
  - Longest-path-in-DAG calculation on diamond graph

---

## Critical Path View

TaskFlow Pro includes a built-in **Critical Path Method (CPM)** engine:
- Computes the longest dependency path by cumulative base duration from source tasks to terminal tasks.
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
