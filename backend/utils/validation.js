/**
 * Input validation helpers for TaskFlow Pro API endpoints
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidId(id) {
  if (!id || typeof id !== 'string') return false;
  return UUID_REGEX.test(id) || /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

export function isValidDate(dateStr) {
  if (!dateStr) return true; // Optional
  if (typeof dateStr !== 'string') return false;
  if (!DATE_REGEX.test(dateStr)) return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
}

export function isValidColumnStatus(status) {
  const allowed = ['backlog', 'in_progress', 'review', 'done'];
  return allowed.includes(status);
}

export function validateTaskInput({ title, column_status, start_date, end_date, base_duration_days }, isCreate = false) {
  const errors = [];

  if (isCreate && (title === undefined || title === null)) {
    errors.push('Task title is required.');
  }

  if (title !== undefined && title !== null) {
    if (typeof title !== 'string' || !title.trim()) {
      errors.push('Task title must be a non-empty string.');
    } else if (title.trim().length > 255) {
      errors.push('Task title must not exceed 255 characters.');
    }
  }

  if (column_status !== undefined && column_status !== null && !isValidColumnStatus(column_status)) {
    errors.push(`Invalid column_status: "${column_status}". Allowed: backlog, in_progress, review, done.`);
  }

  if (start_date && !isValidDate(start_date)) {
    errors.push('start_date must be in YYYY-MM-DD format.');
  }

  if (end_date && !isValidDate(end_date)) {
    errors.push('end_date must be in YYYY-MM-DD format.');
  }

  if (start_date && end_date && isValidDate(start_date) && isValidDate(end_date)) {
    if (new Date(start_date) > new Date(end_date)) {
      errors.push('start_date cannot be after end_date.');
    }
  }

  if (base_duration_days !== undefined && base_duration_days !== null) {
    const dur = parseInt(base_duration_days, 10);
    if (isNaN(dur) || dur < 1) {
      errors.push('base_duration_days must be an integer >= 1.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function validateDependencyInput({ task_id, depends_on_task_id }) {
  const errors = [];

  if (!task_id || !isValidId(task_id)) {
    errors.push('Valid task_id (downstream) is required.');
  }

  if (!depends_on_task_id || !isValidId(depends_on_task_id)) {
    errors.push('Valid depends_on_task_id (prerequisite) is required.');
  }

  if (task_id && depends_on_task_id && task_id === depends_on_task_id) {
    errors.push('A task cannot depend on itself (self-referential dependency rejected).');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export default {
  isValidId,
  isValidDate,
  isValidColumnStatus,
  validateTaskInput,
  validateDependencyInput
};
