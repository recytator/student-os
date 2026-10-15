-- Explicit relation: only generated task events are linked, manually-created events stay NULL.
ALTER TABLE calendar_events ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE;
CREATE INDEX events_task ON calendar_events(user_id,task_id);

CREATE TRIGGER events_task_owner_insert BEFORE INSERT ON calendar_events BEGIN
  SELECT RAISE(ABORT,'task ownership') WHERE NEW.task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.task_id AND user_id=NEW.user_id);
END;
CREATE TRIGGER events_task_owner_update BEFORE UPDATE ON calendar_events BEGIN
  SELECT RAISE(ABORT,'task ownership') WHERE NEW.task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.task_id AND user_id=NEW.user_id);
END;

-- Backfill only deterministic, run-namespaced relationships from v1. No title matching.
UPDATE calendar_events SET task_id = (
  SELECT t.id FROM tasks t WHERE t.user_id=calendar_events.user_id
    AND t.document_id=calendar_events.document_id
    AND instr(t.proposal_id,':')>0
    AND calendar_events.proposal_id=substr(t.proposal_id,1,instr(t.proposal_id,':'))||'due-'||substr(t.proposal_id,instr(t.proposal_id,':')+1)
) WHERE task_id IS NULL AND EXISTS (
  SELECT 1 FROM tasks t WHERE t.user_id=calendar_events.user_id
    AND t.document_id=calendar_events.document_id
    AND instr(t.proposal_id,':')>0
    AND calendar_events.proposal_id=substr(t.proposal_id,1,instr(t.proposal_id,':'))||'due-'||substr(t.proposal_id,instr(t.proposal_id,':')+1)
);
UPDATE calendar_events SET task_id = (
  SELECT t.id FROM analysis_results r, json_each(r.blocks_json) b JOIN tasks t
    ON t.proposal_id=r.run_id||':'||json_extract(b.value,'$.proposal_id')
    AND t.user_id=r.user_id AND t.document_id=r.document_id
  WHERE r.user_id=calendar_events.user_id AND r.document_id=calendar_events.document_id
    AND calendar_events.proposal_id=r.run_id||':block-'||json_extract(b.value,'$.id')
  LIMIT 1
) WHERE task_id IS NULL AND EXISTS (
  SELECT 1 FROM analysis_results r, json_each(r.blocks_json) b JOIN tasks t
    ON t.proposal_id=r.run_id||':'||json_extract(b.value,'$.proposal_id')
    AND t.user_id=r.user_id AND t.document_id=r.document_id
  WHERE r.user_id=calendar_events.user_id AND r.document_id=calendar_events.document_id
    AND calendar_events.proposal_id=r.run_id||':block-'||json_extract(b.value,'$.id')
);
