-- Preserve historical execution metadata while making the active-run invariant
-- atomic. Older versions could create duplicate runs in simultaneous requests.
-- Keep the furthest advanced workflow, then the oldest run for stable ordering.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY user_id, document_id
    ORDER BY CASE state
      WHEN 'approval' THEN 5
      WHEN 'review' THEN 4
      WHEN 'planner' THEN 3
      WHEN 'deadline' THEN 2
      ELSE 1 END DESC, created_at ASC, id ASC
  ) AS duplicate_rank
  FROM agent_runs
  WHERE state IN ('document','deadline','planner','review','approval')
)
UPDATE agent_runs
SET state = 'failed',
    error = 'Migracja: zamknięto nadmiarowe równoległe wykonanie; zachowano bardziej zaawansowaną analizę dokumentu.',
    lease_until = 0,
    lease_token = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (SELECT id FROM ranked WHERE duplicate_rank > 1);

CREATE UNIQUE INDEX agent_runs_one_active_document
  ON agent_runs(user_id,document_id)
  WHERE state IN ('document','deadline','planner','review','approval');
