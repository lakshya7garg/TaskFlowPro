# TaskFlow Pro — Known Edge Cases & Failure Scenarios

This document provides an honest, rigorous engineering assessment of known edge cases, concurrency boundaries, and architectural trade-offs in **TaskFlow Pro**. Each scenario details why it matters, current behavior, and why it was scoped accordingly.

---

## 1. Edge Case Master Table

| Case ID | Scenario Name | Purpose (Why it Matters) | Status |
| :--- | :--- | :--- | :---: |
| **EDGE-001** | Concurrent Edits Across Multiple Client Tabs | Prevents data overwrites when two users edit the same task concurrently without refreshing. | `Documented Limitation` |
| **EDGE-002** | Deep Recursion Limit on Massive Graphs | Prevents call stack overflow on extreme linear dependency chains (>10,000 sequential tasks). | `Partially Handled` (DFS bounded by call stack) |
| **EDGE-003** | Timezone & Daylight Saving Date Discrepancies | Avoids $\pm 1$ day boundary shifts during UTC to localized date conversions. | `Partially Handled` (ISO YYYY-MM-DD standardized) |
| **EDGE-004** | Direct Database Bypass / Unchecked Cycle Insertion | Protects graph engine from infinite loops if invalid cyclical data is injected via DB direct writes. | `Documented Limitation` (API layer authoritative) |
| **EDGE-005** | Non-Standard Work Calendars (Weekends & Holidays) | Avoids scheduling tasks onto weekends or company holidays during automated date propagation. | `Documented Limitation` (Calendar days $N+1$) |

---

## 2. Detailed Scenario Breakdown

### EDGE-001: Concurrent Edits Across Multiple Client Tabs (Optimistic Concurrency)
- **Scenario:** Two users open the same task modal in separate browser tabs. User A updates the task `end_date` and propagates the schedule. User B then submits a status change without refreshing their tab.
- **Behavior:** User B's request will update the task status based on stale client-side data, potentially omitting the freshly propagated schedule dates.
- **Why Out of Scope:** Implementing WebSocket real-time synchronization (e.g. Socket.io) or Optimistic Concurrency Control (OCC) with version numbers (`updated_at` / `version` checks) requires additional pub/sub infrastructure, which exceeded the core DAG hackathon sprint scope.
- **Proposed Future Fix:** Add a version/timestamp check in the `PATCH /api/tasks/:id` endpoint and broadcast updates via SSE or WebSockets.

---

### EDGE-002: Deep Recursion Limit on Massive Graphs (Stack Overflow Risk)
- **Scenario:** A task graph contains an extremely deep linear chain (e.g. 10,000+ sequential dependencies $T_1 \to T_2 \to \dots \to T_{10000}$).
- **Behavior:** The synchronous Depth-First Search (`detectCycle`) relies on JavaScript's call stack. Recursion depth exceeding ~10,000 frames will throw a `RangeError: Maximum call stack size exceeded`.
- **Why Out of Scope:** Real-world project dependency chains rarely exceed 100 consecutive levels.
- **Proposed Future Fix:** Replace recursive DFS with an explicit heap-allocated iterative stack array traversal.

---

### EDGE-003: Timezone Discrepancies in Date Math (UTC vs Local Daylight Saving)
- **Scenario:** A user in UTC-8 changes a task end date across a Daylight Saving Time (DST) transition boundary or midnight UTC shift.
- **Behavior:** Date parsing using native `Date.parse()` or standard string operations may experience a $\pm 1$ day boundary offset when converting between UTC ISO strings and localized calendar days.
- **Why Handled via ISO Strings:** TaskFlow Pro standardizes all dates as plain ISO calendar strings (`YYYY-MM-DD`) and uses deterministic day difference arithmetic. Full timezone offset management (e.g., via `date-fns-tz` or `luxon`) was omitted to keep schedule math deterministic.
- **Proposed Future Fix:** Support user-specific timezone preferences stored in user profile configurations.

---

### EDGE-004: Unhandled Circular Dependency in Direct DB Bypass Imports
- **Scenario:** An external system directly inserts a pre-existing circular dependency directly into the database bypass path without invoking the REST API validation layer.
- **Behavior:** Graph algorithms (`recomputeGraphDependencyStatuses`, `calculateCriticalPath`) assuming an acyclic structure could enter infinite loops during topological sorting if run on pre-corrupted data.
- **Why Out of Scope:** Database integrity relies on server-authoritative API routing. Database-level trigger validation was considered redundant for single-entrypoint application access.
- **Proposed Future Fix:** Add a PostgreSQL trigger or check constraint executing cycle validation on row insertion.

---

### EDGE-005: Non-Standard Work Calendars (Weekends & Holidays)
- **Scenario:** A task end date falls on a Friday (`2026-10-09`), and schedule propagation sets the dependent task start date to Saturday (`2026-10-10`).
- **Behavior:** Schedule propagation operates purely on continuous calendar days ($N + 1$) without skipping weekends or statutory holidays.
- **Why Out of Scope:** Custom working-day calendars require complex org-level configuration tables, which were excluded to keep scheduling logic clear and deterministic for evaluation.
- **Proposed Future Fix:** Implement a customizable business calendar module allowing users to toggle weekend skips and define holiday blackout windows.
