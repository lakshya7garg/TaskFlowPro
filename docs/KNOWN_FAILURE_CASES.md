# TaskFlow Pro — Known Edge Cases & Failure Scenarios

This document provides an honest assessment of known edge cases, concurrency behaviors, and scope boundaries in **TaskFlow Pro**. Each item details the specific scenario and why it was intentionally placed out of scope for the current sprint.

---

## 1. Concurrent Edits Across Multiple Client Tabs (Optimistic Concurrency)
- **Scenario:** Two users open the same task modal in separate browser tabs. User A updates the task `end_date` and propagates the schedule. User B then submits a status change without refreshing their tab.
- **Behavior:** User B's request will overwrite the task status based on stale client-side data, potentially missing the freshly propagated schedule dates.
- **Why Out of Scope:** Implementing WebSocket real-time synchronization (e.g. Socket.io) or Optimistic Concurrency Control (OCC) with version numbers (`updated_at` checks) requires additional pub/sub infrastructure, which exceeded the core DAG hackathon sprint scope.

---

## 2. Deep Recursion Limit on Massive Graphs (Stack Overflow Risk)
- **Scenario:** A task graph contains an extremely deep linear chain (e.g. 5,000+ sequential dependencies $T_1 \to T_2 \to \dots \to T_{5000}$).
- **Behavior:** The synchronous Depth-First Search (`detectCycle`) relies on JavaScript's call stack. Recursion depth exceeding ~10,000 frames will throw a `RangeError: Maximum call stack size exceeded`.
- **Why Out of Scope:** Real-world project dependency chains rarely exceed 100 consecutive levels. Replacing recursion with an explicit iterative stack array was deferred to future performance hardening.

---

## 3. Timezone Discrepancies in Date Math (UTC vs Local Daylight Saving)
- **Scenario:** A user in UTC-8 changes a task end date across a Daylight Saving Time (DST) transition boundary or midnight UTC shift.
- **Behavior:** Date parsing using native `Date.parse()` or standard string operations may experience a $\pm 1$ day boundary offset when converting between UTC ISO strings and localized calendar days.
- **Why Out of Scope:** TaskFlow Pro standardizes dates as plain ISO calendar strings (`YYYY-MM-DD`). Full timezone offset management (e.g., via `date-fns-tz` or `luxon`) was omitted to keep schedule math deterministic.

---

## 4. Unhandled Circular Dependency in Legacy Batch Imports
- **Scenario:** An external system directly inserts a pre-existing circular dependency directly into the database bypass path without invoking the REST API validation layer.
- **Behavior:** Graph algorithms (`recomputeGraphDependencyStatuses`, `calculateCriticalPath`) assuming an acyclic structure could enter infinite loops during topological sorting if run on pre-corrupted data.
- **Why Out of Scope:** Database integrity relies on server-authoritative API routing. Database-level trigger validation was considered redundant for single-entrypoint application access.

---

## 5. Non-Standard Work Calendars (Weekends & Holidays)
- **Scenario:** A task end date falls on a Friday (`2026-10-09`), and schedule propagation sets the dependent task start date to Saturday (`2026-10-10`).
- **Behavior:** Schedule propagation operates purely on continuous calendar days ($N + 1$) without skipping weekends or statutory holidays.
- **Why Out of Scope:** Custom working-day calendars require complex org-level configuration tables, which were excluded to keep scheduling logic clear and deterministic for evaluation.
