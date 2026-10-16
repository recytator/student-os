-- One further recovery for DeadlineAgent after enforcing provider-side JSON schemas.
-- Preserve the successful DocumentAgent checkpoint and all real usage reservations.
UPDATE agent_runs AS r
SET state='deadline',retries=0,error=NULL,lease_token=NULL,lease_until=0,
    context_json=json_set(context_json,'$.deadline_schema_recovery',1),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE state='failed' AND calls<12
  AND json_extract(context_json,'$.deadline_schema_recovery') IS NULL
  AND NOT EXISTS(SELECT 1 FROM agent_runs newer WHERE newer.user_id=r.user_id AND newer.document_id=r.document_id AND newer.rowid>r.rowid)
  AND EXISTS(
    SELECT 1 FROM agent_steps step,json_each(step.validation_json,'$.issues') issue
    WHERE step.run_id=r.id AND step.agent='deadline' AND step.state='failed'
      AND step.rowid=(SELECT max(last_step.rowid) FROM agent_steps last_step WHERE last_step.run_id=r.id)
      AND json_extract(step.validation_json,'$.validation_code')='SCHEMA'
      AND json_extract(issue.value,'$.code')='too_big'
      AND json_extract(issue.value,'$.path[0]')='proposals'
      AND json_extract(issue.value,'$.path[2]')='sources'
  );
