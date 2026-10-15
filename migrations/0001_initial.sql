-- StudentOS schema v1. UTC instants, date/time fields represent Europe/Warsaw.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_id TEXT NOT NULL UNIQUE,
  github_login TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, -- SHA-256 of the opaque cookie, never the bearer token.
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX sessions_user_expiry ON sessions(user_id,expires_at);
CREATE TABLE oauth_states (
  id TEXT PRIMARY KEY,
  verifier TEXT NOT NULL, -- SHA-256 of the browser-held verifier, not the raw value.
  expires_at INTEGER NOT NULL
);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0)
);

CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 240),
  teacher TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#8b8cf8',
  class_type TEXT NOT NULL DEFAULT 'wykład',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX subjects_owner ON subjects(user_id,name);
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  hash TEXT NOT NULL CHECK(length(hash)=64),
  academic_year TEXT NOT NULL,
  page_count INTEGER NOT NULL CHECK(page_count BETWEEN 1 AND 100),
  text_length INTEGER NOT NULL CHECK(text_length BETWEEN 0 AND 120000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id,hash)
);
CREATE INDEX documents_owner ON documents(user_id,created_at);
CREATE TABLE document_sections (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page INTEGER NOT NULL CHECK(page BETWEEN 1 AND 300),
  text TEXT NOT NULL CHECK(length(text)<=30000),
  UNIQUE(document_id,page)
);
CREATE INDEX document_sections_owner ON document_sections(user_id,document_id);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','done')),
  notes TEXT NOT NULL DEFAULT '',
  proposal_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id,document_id,proposal_id)
);
CREATE INDEX tasks_owner_due ON tasks(user_id,status,due_date);
CREATE INDEX tasks_subject ON tasks(subject_id);
CREATE INDEX tasks_document ON tasks(document_id);
CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','done')),
  position INTEGER NOT NULL DEFAULT 0 CHECK(position>=0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX subtasks_parent ON subtasks(user_id,task_id,position);
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  proposal_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(julianday(end_at)>julianday(start_at)),
  UNIQUE(user_id,document_id,proposal_id)
);
CREATE INDEX events_owner_time ON calendar_events(user_id,start_at,end_at);
CREATE TABLE class_schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(end_time>start_time),
  CHECK(valid_to>=valid_from)
);
CREATE INDEX schedules_owner_weekday ON class_schedules(user_id,weekday,valid_from,valid_to);
CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  value_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(value_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'document' CHECK(state IN ('document','deadline','planner','review','approval','committed','failed')),
  context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)),
  model TEXT NOT NULL,
  cache_key TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  calls INTEGER NOT NULL DEFAULT 0 CHECK(calls>=0),
  retries INTEGER NOT NULL DEFAULT 0 CHECK(retries>=0),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX agent_runs_owner ON agent_runs(user_id,created_at);
CREATE INDEX agent_runs_cache ON agent_runs(user_id,cache_key,state);
CREATE TABLE agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent TEXT NOT NULL CHECK(agent IN ('document','deadline','planner','review','orchestrator')),
  state TEXT NOT NULL CHECK(state IN ('running','completed','failed','cached')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  model TEXT,
  input_summary TEXT NOT NULL DEFAULT '',
  output_summary TEXT NOT NULL DEFAULT '',
  output_json TEXT CHECK(output_json IS NULL OR json_valid(output_json)),
  validation_json TEXT CHECK(validation_json IS NULL OR json_valid(validation_json)),
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  input_tokens INTEGER,
  output_tokens INTEGER
);
CREATE INDEX agent_steps_run ON agent_steps(run_id,started_at);
CREATE TABLE analysis_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  proposals_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(proposals_json)),
  blocks_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(blocks_json)),
  review_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(review_json)),
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX analysis_results_owner ON analysis_results(user_id,document_id);
CREATE TABLE ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  analyses INTEGER NOT NULL DEFAULT 0 CHECK(analyses>=0),
  calls INTEGER NOT NULL DEFAULT 0 CHECK(calls>=0),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK(input_tokens>=0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK(output_tokens>=0),
  PRIMARY KEY(user_id,day)
);

-- Cross-user relations are rejected even if a caller guesses another record ID.
CREATE TRIGGER tasks_owner_insert BEFORE INSERT ON tasks BEGIN
  SELECT RAISE(ABORT,'subject ownership') WHERE NEW.subject_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM subjects WHERE id=NEW.subject_id AND user_id=NEW.user_id);
  SELECT RAISE(ABORT,'document ownership') WHERE NEW.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM documents WHERE id=NEW.document_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER tasks_owner_update BEFORE UPDATE ON tasks BEGIN
  SELECT RAISE(ABORT,'subject ownership') WHERE NEW.subject_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM subjects WHERE id=NEW.subject_id AND user_id=NEW.user_id);
  SELECT RAISE(ABORT,'document ownership') WHERE NEW.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM documents WHERE id=NEW.document_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER events_owner_insert BEFORE INSERT ON calendar_events BEGIN
  SELECT RAISE(ABORT,'subject ownership') WHERE NEW.subject_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM subjects WHERE id=NEW.subject_id AND user_id=NEW.user_id);
  SELECT RAISE(ABORT,'document ownership') WHERE NEW.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM documents WHERE id=NEW.document_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER events_owner_update BEFORE UPDATE ON calendar_events BEGIN
  SELECT RAISE(ABORT,'subject ownership') WHERE NEW.subject_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM subjects WHERE id=NEW.subject_id AND user_id=NEW.user_id);
  SELECT RAISE(ABORT,'document ownership') WHERE NEW.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM documents WHERE id=NEW.document_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER schedules_owner_insert BEFORE INSERT ON class_schedules BEGIN
  SELECT RAISE(ABORT,'subject ownership') WHERE NOT EXISTS(SELECT 1 FROM subjects WHERE id=NEW.subject_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER schedules_owner_update BEFORE UPDATE ON class_schedules BEGIN
  SELECT RAISE(ABORT,'subject ownership') WHERE NOT EXISTS(SELECT 1 FROM subjects WHERE id=NEW.subject_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER documents_owner_insert BEFORE INSERT ON documents BEGIN
  SELECT RAISE(ABORT,'subject ownership') WHERE NEW.subject_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM subjects WHERE id=NEW.subject_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER documents_owner_update BEFORE UPDATE ON documents BEGIN
  SELECT RAISE(ABORT,'subject ownership') WHERE NEW.subject_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM subjects WHERE id=NEW.subject_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER subtasks_owner_insert BEFORE INSERT ON subtasks BEGIN
  SELECT RAISE(ABORT,'task ownership') WHERE NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.task_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER subtasks_owner_update BEFORE UPDATE ON subtasks BEGIN
  SELECT RAISE(ABORT,'task ownership') WHERE NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.task_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER sections_owner_insert BEFORE INSERT ON document_sections BEGIN
  SELECT RAISE(ABORT,'document ownership') WHERE NOT EXISTS(SELECT 1 FROM documents WHERE id=NEW.document_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER runs_owner_insert BEFORE INSERT ON agent_runs BEGIN
  SELECT RAISE(ABORT,'document ownership') WHERE NOT EXISTS(SELECT 1 FROM documents WHERE id=NEW.document_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER steps_owner_insert BEFORE INSERT ON agent_steps BEGIN
  SELECT RAISE(ABORT,'run ownership') WHERE NOT EXISTS(SELECT 1 FROM agent_runs WHERE id=NEW.run_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER results_owner_insert BEFORE INSERT ON analysis_results BEGIN
  SELECT RAISE(ABORT,'run ownership') WHERE NOT EXISTS(SELECT 1 FROM agent_runs WHERE id=NEW.run_id AND user_id=NEW.user_id AND document_id=NEW.document_id);
END;
