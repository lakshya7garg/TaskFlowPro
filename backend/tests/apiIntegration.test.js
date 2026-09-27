import request from 'supertest';
import app from '../index.js';
import { runSeed } from '../scripts/seed.js';

describe('TaskFlow Pro - Express API Integration Tests', () => {

  beforeEach(async () => {
    // Reset seed data before each integration test suite
    await runSeed();
  });

  describe('Health & Tasks CRUD Endpoints', () => {
    test('GET /api/health returns healthy status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
    });

    test('GET /api/tasks returns all seeded tasks with computed dependency status', async () => {
      const res = await request(app).get('/api/tasks');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.tasks)).toBe(true);
      expect(res.body.tasks.length).toBe(9);

      // Verify computed dependency_status is present
      const taskT1 = res.body.tasks.find(t => t.id === 'a0000000-0000-0000-0000-000000000001');
      const taskT4 = res.body.tasks.find(t => t.id === 'a0000000-0000-0000-0000-000000000004');
      expect(taskT1.dependency_status).toBe('ready');
      expect(taskT4.dependency_status).toBe('blocked'); // Blocked because T2 & T3 are in_progress
    });

    test('POST /api/tasks creates task with valid inputs and rejects invalid inputs with 400', async () => {
      // Missing title
      const badRes = await request(app).post('/api/tasks').send({
        description: 'No title'
      });
      expect(badRes.status).toBe(400);
      expect(badRes.body.success).toBe(false);

      // Valid task creation
      const validRes = await request(app).post('/api/tasks').send({
        title: 'New Integration Test Task',
        description: 'Testing task creation endpoint',
        column_status: 'backlog',
        start_date: '2026-10-20',
        end_date: '2026-10-22',
        base_duration_days: 3
      });
      expect(validRes.status).toBe(201);
      expect(validRes.body.success).toBe(true);
      expect(validRes.body.task.title).toBe('New Integration Test Task');
      expect(validRes.body.task.dependency_status).toBe('ready');
    });
  });

  describe('Dependency & DAG Cycle Check Endpoints', () => {
    test('POST /api/dependencies rejects self-referential dependency with 400', async () => {
      const res = await request(app).post('/api/dependencies').send({
        task_id: 'a0000000-0000-0000-0000-000000000001',
        depends_on_task_id: 'a0000000-0000-0000-0000-000000000001'
      });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('cannot depend on itself');
    });

    test('POST /api/dependencies detects and rejects circular dependency with 400 and cycle path', async () => {
      // In seed data: T1 -> T2 -> T4
      // Attempting to make T1 depend on T4 creates a cycle: T4 -> ... -> T1 -> T2 -> T4
      const res = await request(app).post('/api/dependencies').send({
        task_id: 'a0000000-0000-0000-0000-000000000001',
        depends_on_task_id: 'a0000000-0000-0000-0000-000000000004'
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.cycleDetected).toBe(true);
      expect(res.body.error).toContain('would create a cycle');
      expect(Array.isArray(res.body.cyclePath)).toBe(true);
    });

    test('POST /api/dependencies adds valid dependency and updates graph', async () => {
      // Create new independent task
      const newTaskRes = await request(app).post('/api/tasks').send({
        title: 'Independent Task',
        column_status: 'backlog'
      });
      const newTaskId = newTaskRes.body.task.id;

      // Link new task to depend on T1 (which is done)
      const depRes = await request(app).post('/api/dependencies').send({
        task_id: newTaskId,
        depends_on_task_id: 'a0000000-0000-0000-0000-000000000001'
      });

      expect(depRes.status).toBe(201);
      expect(depRes.body.success).toBe(true);
    });
  });

  describe('Move & Rollback on Regression via HTTP', () => {
    test('POST /api/tasks/:id/move prevents moving a blocked task to in_progress with 400', async () => {
      // T4 is blocked by T2 and T3
      const res = await request(app).post('/api/tasks/a0000000-0000-0000-0000-000000000004/move').send({
        column_status: 'in_progress'
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Cannot move blocked task');
    });

    test('Moving prerequisite to Done transitions dependent from Blocked to Ready', async () => {
      // In seed: T2 and T3 are in_progress. T4 depends on both.
      // Move T2 to done
      await request(app).post('/api/tasks/a0000000-0000-0000-0000-000000000002/move').send({
        column_status: 'done'
      });
      // Move T3 to done
      await request(app).post('/api/tasks/a0000000-0000-0000-0000-000000000003/move').send({
        column_status: 'done'
      });

      // Fetch tasks and verify T4 is now ready!
      const tasksRes = await request(app).get('/api/tasks');
      const taskT4 = tasksRes.body.tasks.find(t => t.id === 'a0000000-0000-0000-0000-000000000004');
      expect(taskT4.dependency_status).toBe('ready');
    });

    test('Rollback on Regression: Moving Done back to In Progress re-blocks downstream tasks via HTTP', async () => {
      // Step 1: Complete T2 and T3 so T4 is ready
      await request(app).post('/api/tasks/a0000000-0000-0000-0000-000000000002/move').send({ column_status: 'done' });
      await request(app).post('/api/tasks/a0000000-0000-0000-0000-000000000003/move').send({ column_status: 'done' });

      // Step 2: Move T2 BACK to in_progress (regression)
      await request(app).post('/api/tasks/a0000000-0000-0000-0000-000000000002/move').send({ column_status: 'in_progress' });

      // Step 3: Fetch tasks and verify T4 is RE-BLOCKED!
      const tasksRes = await request(app).get('/api/tasks');
      const taskT4 = tasksRes.body.tasks.find(t => t.id === 'a0000000-0000-0000-0000-000000000004');
      expect(taskT4.dependency_status).toBe('blocked');
    });
  });

  describe('Schedule Propagation Endpoint (Diamond No-Compounding)', () => {
    test('POST /api/tasks/:id/reschedule propagates dates through diamond without compounding', async () => {
      // Reschedule T1 by +3 days (end_date: 2026-10-06)
      const res = await request(app).post('/api/tasks/a0000000-0000-0000-0000-000000000001/reschedule').send({
        start_date: '2026-10-01',
        end_date: '2026-10-06',
        buffer_days: 1
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.auditLogs.length).toBeGreaterThan(0);

      // Verify T4 shifted to start after the latest of T2/T3
      const tasksRes = await request(app).get('/api/tasks');
      const t2 = tasksRes.body.tasks.find(t => t.id === 'a0000000-0000-0000-0000-000000000002');
      const t3 = tasksRes.body.tasks.find(t => t.id === 'a0000000-0000-0000-0000-000000000003');
      const t4 = tasksRes.body.tasks.find(t => t.id === 'a0000000-0000-0000-0000-000000000004');

      expect(t2.start_date).toBe('2026-10-07');
      expect(t3.start_date).toBe('2026-10-07');
      expect(t4.start_date).toBe('2026-10-11'); // Latest of T2 (10-10) and T3 (10-10) + 1 day
    });
  });

  describe('AI Suggestions & Critical Path Endpoints', () => {
    test('GET /api/critical-path returns critical path tasks and duration', async () => {
      const res = await request(app).get('/api/critical-path');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalDurationDays).toBeGreaterThan(0);
      expect(Array.isArray(res.body.criticalPathTaskIds)).toBe(true);
    });

    test('POST /api/ai-suggestions/generate and accept/reject workflow', async () => {
      // Generate suggestions for T4
      const genRes = await request(app).post('/api/ai-suggestions/generate').send({
        task_id: 'a0000000-0000-0000-0000-000000000004'
      });
      expect(genRes.status).toBe(200);
      expect(genRes.body.success).toBe(true);

      // Fetch suggestions
      const listRes = await request(app).get('/api/tasks/a0000000-0000-0000-0000-000000000004/ai-suggestions');
      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);

      if (listRes.body.suggestions.length > 0) {
        const firstSug = listRes.body.suggestions[0];
        // Reject suggestion
        const rejRes = await request(app).post(`/api/ai-suggestions/${firstSug.id}/reject`);
        expect(rejRes.status).toBe(200);
        expect(rejRes.body.success).toBe(true);
      }
    });
  });

});
