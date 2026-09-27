-- TaskFlow Pro Database Schema (PostgreSQL)

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
