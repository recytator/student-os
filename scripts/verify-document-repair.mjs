import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Verify the persistent import and continue only the owner's latest run stopped
// by the repaired source-array defect. Never create a new analysis or approve results.
const config = JSON.parse(await readFile('wrangler.production.json', 'utf8'));
const origin = config.vars.APP_ORIGIN;
if (origin !== 'https://studentos.recytator.workers.dev') throw new Error('UNEXPECTED_ORIGIN');
const database = config.d1_databases[0].database_id;
const cf = async (sql, params = []) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${database}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json();
  if (!response.ok || !body.success || body.result.some((result) => !result.success))
    throw new Error('D1_VERIFICATION_FAILED');
  return body.result[0].results;
};
const [owner] = await cf('SELECT id FROM users WHERE github_id=?', [config.vars.GITHUB_OWNER_ID]);
if (!owner) throw new Error('EXISTING_OWNER_REQUIRED');
if (process.env.STUDENTOS_REPAIR_DIAGNOSE === 'true') {
  const steps = await cf(
    `SELECT agent,state,duration_ms,validation_json,error FROM agent_steps
    WHERE run_id=(SELECT id FROM agent_runs WHERE user_id=? ORDER BY rowid DESC LIMIT 1)
    ORDER BY rowid`,
    [owner.id],
  );
  console.log(JSON.stringify({ diagnostic: 'operational_metadata_only', steps }));
  process.exit(0);
}
const [imported] = await cf(
  "SELECT json_extract(data_json,'$.group') AS class_group,json_extract(data_json,'$.starts_on') AS starts_on,json_array_length(data_json,'$.entries') AS entries FROM semester_timetables WHERE user_id=? AND semester_key='2026-2027-winter'",
  [owner.id],
);
if (
  imported?.class_group !== 'GI1 / GL2' ||
  imported.starts_on !== '2026-10-04' ||
  imported.entries !== 18
)
  throw new Error('TIMETABLE_IMPORT_MISSING');
console.log(JSON.stringify({ timetable: 'verified_in_production_D1', ...imported }));
const [candidate] = await cf(
  `SELECT r.id,r.calls FROM agent_runs r
  WHERE r.user_id=? AND r.state='document' AND r.calls<12
    AND r.rowid=(SELECT max(newer.rowid) FROM agent_runs newer WHERE newer.user_id=r.user_id)
    AND EXISTS(SELECT 1 FROM agent_steps step,json_each(step.validation_json,'$.issues') issue
      WHERE step.run_id=r.id AND step.agent='document' AND step.state='failed'
        AND step.rowid=(SELECT max(last_step.rowid) FROM agent_steps last_step WHERE last_step.run_id=r.id)
        AND json_extract(step.validation_json,'$.validation_code')='SCHEMA'
        AND json_extract(issue.value,'$.code')='too_big'
        AND json_extract(issue.value,'$.path[0]')='sections'
        AND json_extract(issue.value,'$.path[2]')='sources')`,
  [owner.id],
);
if (!candidate) {
  console.log(JSON.stringify({ document_repair: 'no_matching_run_to_continue' }));
} else {
  const token = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(token).digest('base64url');
  await cf('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)', [
    digest,
    owner.id,
    Math.floor(Date.now() / 1000) + 600,
  ]);
  try {
    const api = async (path, method = 'GET') => {
      const response = await fetch(origin + path, {
        method,
        headers: { Cookie: `studentos_session=${token}`, Origin: origin },
        signal: AbortSignal.timeout(190_000),
        redirect: 'error',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(`REPAIR_HTTP_${response.status}`);
      return body;
    };
    // Read back through the actual private HTTPS API, not only SQL.
    const bootstrap = await api('/api/bootstrap');
    if (
      !bootstrap.timetables.some(
        (timetable) => timetable.group === 'GI1 / GL2' && timetable.entries.length === 18,
      )
    )
      throw new Error('TIMETABLE_HTTPS_MISSING');
    let detail = await api(`/api/runs/${candidate.id}`);
    for (
      let step = 0;
      step < 10 && !['approval', 'committed', 'failed'].includes(detail.run.state);
      step++
    ) {
      detail = await api(`/api/runs/${candidate.id}/advance`, 'POST');
      console.log(
        JSON.stringify({
          document_repair: 'production_progress',
          state: detail.run.state,
          calls: detail.run.calls,
        }),
      );
    }
    if (detail.run.state !== 'approval' && detail.run.state !== 'committed')
      throw new Error('REPAIRED_ANALYSIS_NOT_COMPLETE');
    console.log(
      JSON.stringify({
        document_repair: 'ready_for_owner_review',
        calls: detail.run.calls,
        automatically_approved: false,
      }),
    );
  } finally {
    // Remove only the short-lived maintenance session, never an owner's device session.
    await cf('DELETE FROM sessions WHERE id=? AND user_id=?', [digest, owner.id]);
  }
}
