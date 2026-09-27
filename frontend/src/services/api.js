const API_BASE = '/api';

export async function fetchTasks() {
  const res = await fetch(`${API_BASE}/tasks`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch tasks');
  return data.tasks;
}

export async function createTask(taskData) {
  const res = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(taskData)
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to create task');
  return data.task;
}

export async function updateTask(id, updates) {
  const res = await fetch(`${API_BASE}/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to update task');
  return data.task;
}

export async function moveTask(id, column_status, position = 0) {
  const res = await fetch(`${API_BASE}/tasks/${id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column_status, position })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to move task');
  return data;
}

export async function rescheduleTask(id, start_date, end_date, buffer_days = 1) {
  const res = await fetch(`${API_BASE}/tasks/${id}/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_date, end_date, buffer_days })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to reschedule task');
  return data;
}

export async function deleteTask(id) {
  const res = await fetch(`${API_BASE}/tasks/${id}`, {
    method: 'DELETE'
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to delete task');
  return data;
}

export async function addDependency(task_id, depends_on_task_id, source = 'manual') {
  const res = await fetch(`${API_BASE}/dependencies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id, depends_on_task_id, source })
  });
  const data = await res.json();
  if (!data.success) {
    const error = new Error(data.error || 'Failed to add dependency');
    error.cycleDetected = data.cycleDetected;
    error.cyclePath = data.cyclePath;
    throw error;
  }
  return data;
}

export async function removeDependency(dependency_id) {
  const res = await fetch(`${API_BASE}/dependencies/${dependency_id}`, {
    method: 'DELETE'
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to remove dependency');
  return data;
}

export async function fetchAiSuggestions(task_id) {
  const res = await fetch(`${API_BASE}/tasks/${task_id}/ai-suggestions`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch AI suggestions');
  return data.suggestions;
}

export async function generateAiSuggestions(task_id) {
  const res = await fetch(`${API_BASE}/ai-suggestions/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to generate AI suggestions');
  return data;
}

export async function acceptAiSuggestion(suggestion_id) {
  const res = await fetch(`${API_BASE}/ai-suggestions/${suggestion_id}/accept`, {
    method: 'POST'
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to accept suggestion');
  return data;
}

export async function rejectAiSuggestion(suggestion_id) {
  const res = await fetch(`${API_BASE}/ai-suggestions/${suggestion_id}/reject`, {
    method: 'POST'
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to reject suggestion');
  return data;
}

export async function fetchCriticalPath() {
  const res = await fetch(`${API_BASE}/critical-path`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch critical path');
  return data;
}

export async function fetchAuditLogs() {
  const res = await fetch(`${API_BASE}/audit-logs`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch audit logs');
  return data.logs;
}

export async function resetDemoData() {
  const res = await fetch(`${API_BASE}/seed/reset`, {
    method: 'POST'
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to reset demo data');
  return data;
}
