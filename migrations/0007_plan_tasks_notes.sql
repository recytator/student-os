-- StudentOS v0.2: recurring classes carry their own type and certainty, single weeks can be
-- cancelled or confirmed, tasks have a kind (exam, colloquium, project) and documents can
-- have AI study notes. Existing rows keep their meaning through defaults.
ALTER TABLE class_schedules ADD COLUMN class_type TEXT NOT NULL DEFAULT '';
ALTER TABLE class_schedules ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE class_schedules ADD COLUMN tentative INTEGER NOT NULL DEFAULT 0 CHECK(tentative IN (0,1));
ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'task' CHECK(kind IN ('task','exam','colloquium','project'));

CREATE TABLE schedule_exceptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_id TEXT NOT NULL REFERENCES class_schedules(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('cancelled','confirmed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(schedule_id,date)
);
CREATE INDEX schedule_exceptions_owner ON schedule_exceptions(user_id,date);
CREATE TRIGGER schedule_exceptions_owner_insert BEFORE INSERT ON schedule_exceptions BEGIN
  SELECT RAISE(ABORT,'schedule ownership') WHERE NOT EXISTS(SELECT 1 FROM class_schedules WHERE id=NEW.schedule_id AND user_id=NEW.user_id);
END;

CREATE TABLE document_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','ready','failed')),
  detail TEXT NOT NULL DEFAULT 'standard' CHECK(detail IN ('concise','standard','detailed')),
  chunks_total INTEGER NOT NULL CHECK(chunks_total BETWEEN 1 AND 20),
  chunks_done INTEGER NOT NULL DEFAULT 0 CHECK(chunks_done>=0),
  content_json TEXT NOT NULL DEFAULT '{"parts":[]}' CHECK(json_valid(content_json)),
  model TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0 CHECK(calls>=0),
  input_tokens INTEGER,
  output_tokens INTEGER,
  error TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id,document_id)
);
CREATE INDEX document_notes_owner ON document_notes(user_id,updated_at);
CREATE TRIGGER document_notes_owner_insert BEFORE INSERT ON document_notes BEGIN
  SELECT RAISE(ABORT,'document ownership') WHERE NOT EXISTS(SELECT 1 FROM documents WHERE id=NEW.document_id AND user_id=NEW.user_id);
END;

-- Timetable import: turn the stored 2026/2027 winter transcription into editable recurring
-- classes. Week ranges come from the transcribed notes; "tygodnie do ustalenia" stays
-- tentative so every such week is visibly unconfirmed. The semester end is not on the
-- source photo: 31.01.2027 is an editable default. Deterministic IDs make this idempotent.
INSERT OR IGNORE INTO class_schedules(id,user_id,subject_id,weekday,start_time,end_time,valid_from,valid_to,location,class_type,notes,tentative)
SELECT 'tt-' || t.id || '-' || e.key, t.user_id, s.id,
  json_extract(e.value,'$.weekday'), json_extract(e.value,'$.start_time'), json_extract(e.value,'$.end_time'),
  CASE
    WHEN json_extract(e.value,'$.notes') LIKE '%od 10.11.2026%' THEN '2026-11-10'
    WHEN json_extract(e.value,'$.notes') LIKE '%od 8. tygodnia%' THEN '2026-11-23'
    ELSE '2026-10-05' END,
  CASE WHEN json_extract(e.value,'$.notes') LIKE '%do 03.11.2026%' THEN '2026-11-03' ELSE '2027-01-31' END,
  json_extract(e.value,'$.location'), json_extract(e.value,'$.class_type'), json_extract(e.value,'$.notes'),
  CASE WHEN json_extract(e.value,'$.notes') LIKE '%do ustalenia%' THEN 1 ELSE 0 END
FROM semester_timetables t, json_each(t.data_json,'$.entries') e
JOIN subjects s ON s.user_id=t.user_id AND s.name=json_extract(e.value,'$.subject_name')
WHERE t.semester_key='2026-2027-winter';
-- The subject-level "wykład / GI1" label duplicated the per-class type above.
UPDATE subjects SET class_type='' WHERE class_type='wykład / GI1' AND id IN (SELECT subject_id FROM class_schedules WHERE id LIKE 'tt-%');
