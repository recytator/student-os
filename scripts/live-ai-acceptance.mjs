import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rm, appendFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'jsonc-parser';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USER = 'local-developer';
const GITHUB_ID = '0';
const PORT = 8900;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MAX_CALLS = 5;
const MAX_DURATION = 12 * 60_000;
const MODEL = '@cf/zai-org/glm-4.7-flash';
const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

/** Config contains no credentials. The entire application runs locally; only bindings are remote. */
export function liveConfig(original, databaseId, directory = root) {
  if (!/^[a-f0-9-]{36}$/i.test(databaseId)) throw new Error('INVALID_D1_ID');
  return {
    $schema: resolve(directory, 'node_modules/wrangler/config-schema.json'),
    name: 'studentos-live-acceptance',
    main: resolve(directory, 'worker/index.ts'),
    compatibility_date: original.compatibility_date,
    assets: {
      directory: resolve(directory, 'dist'),
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: ['/api/*'],
    },
    d1_databases: [
      { binding: 'DB', database_name: 'studentos', database_id: databaseId, remote: true },
    ],
    ai: { binding: 'AI', remote: true },
    vars: { DEV_AUTH: 'true', AI_MODEL: MODEL, APP_ORIGIN: ORIGIN },
    observability: { enabled: false },
  };
}

/** Only public fixture data and schema-validated operational outputs may enter artifacts. */
export function operationalDetail(detail) {
  return {
    run: detail.run,
    result: detail.result,
    steps: (detail.steps ?? []).map((step) => ({
      agent: step.agent,
      state: step.state,
      started_at: step.started_at,
      finished_at: step.finished_at,
      duration_ms: step.duration_ms,
      model: step.model,
      attempt: step.attempt,
      input_summary: step.input_summary,
      output_summary: step.output_summary,
      validation_json: step.validation_json,
      output_json: step.output_json,
      error: step.error,
      input_tokens: step.input_tokens,
      output_tokens: step.output_tokens,
    })),
  };
}

export function goldMetrics(proposals, gold) {
  const expected = new Set(gold.filter((entry) => entry.due_date).map((entry) => entry.due_date));
  const found = new Set(proposals.filter((entry) => entry.due_date).map((entry) => entry.due_date));
  const matches = [...found].filter((date) => expected.has(date)).length;
  return {
    method:
      'Distinct explicit deadline dates compared with handwritten public fixture gold; does not score task-title semantics.',
    expected_distinct_dates: expected.size,
    found_distinct_dates: found.size,
    matched_distinct_dates: matches,
    precision: found.size ? matches / found.size : 0,
    recall: expected.size ? matches / expected.size : 0,
    requires_manual_confirmation: proposals.filter((proposal) => proposal.requires_confirmation)
      .length,
  };
}

export async function main() {
  const began = Date.now();
  const artifactDir = resolve(root, 'artifacts/live-ai');
  const temporaryConfig = resolve(root, `.wrangler/live-ai-${randomUUID()}.json`);
  const report = {
    status: 'blocked',
    started_at: new Date().toISOString(),
    execution:
      'Actual StudentOS Worker executed on loopback using actual remote Cloudflare D1 and Workers AI bindings. OAuth/browser production login and production Workers Free CPU limits are not covered.',
    model: MODEL,
    maximum_model_calls: MAX_CALLS,
    orchestrator_call_reservations: 0,
    public_fixture: 'tests/fixtures/syllabus-exact.json',
    call_count_note:
      'Reservations counted by the orchestrator include failures; they are not a provider billing measurement.',
    completed_model_responses: 0,
    cleanup: 'not_needed',
    stages: [],
    metrics: null,
    checks: {},
    error: null,
  };
  let databaseId;
  let child;
  let childExited = false;
  let isolatedInitially = false;
  let documentId;
  let runId;
  let detail;
  let deadlineTimer;
  let childLog = '';
  const deadline = new AbortController();
  const assertRemaining = () => {
    if (Date.now() - began > MAX_DURATION || deadline.signal.aborted)
      throw new Error('OVERALL_TIMEOUT');
  };
  const cf = async (path, method = 'GET', data, cleanup = false) => {
    if (!cleanup) assertRemaining();
    let response;
    try {
      response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
          signal: cleanup
            ? AbortSignal.timeout(20_000)
            : AbortSignal.any([deadline.signal, AbortSignal.timeout(30_000)]),
        },
      );
    } catch {
      throw new Error(cleanup ? 'CLEANUP_API_UNREACHABLE' : 'CLOUDFLARE_API_UNREACHABLE');
    }
    const body = await response.json();
    if (!response.ok || !body.success) {
      const codes = (body.errors ?? [])
        .map((error) => Number(error.code))
        .filter(Number.isFinite)
        .join('_');
      throw new Error(`CLOUDFLARE_HTTP_${response.status}${codes ? `_CODE_${codes}` : ''}`);
    }
    return body.result;
  };
  const query = async (sql, params = [], cleanup = false) => {
    if (!databaseId) throw new Error('D1_NOT_SELECTED');
    const results = await cf(`/d1/database/${databaseId}/query`, 'POST', { sql, params }, cleanup);
    if (!Array.isArray(results) || results.some((result) => !result.success))
      throw new Error('D1_QUERY_FAILED');
    return results[0]?.results ?? [];
  };
  const api = async (path, method = 'GET', data) => {
    assertRemaining();
    const response = await fetch(ORIGIN + '/api' + path, {
      method,
      headers: {
        Origin: ORIGIN,
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: AbortSignal.any([deadline.signal, AbortSignal.timeout(195_000)]),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(`LOCAL_API_HTTP_${response.status}_${result.error?.code || 'UNKNOWN'}`);
    return result;
  };
  const stop = async () => {
    if (!child || childExited) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    const until = Date.now() + 8_000;
    while (!childExited && Date.now() < until) await sleep(100);
    if (!childExited) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  };
  const cleanup = async () => {
    if (isolatedInitially && databaseId) {
      try {
        const users = await query(
          'SELECT id,github_id,github_login FROM users WHERE id=? OR github_id=?',
          [USER, GITHUB_ID],
          true,
        );
        if (!users.length) report.cleanup = 'nothing_created';
        else {
          const unexpected = await query(
            `SELECT (SELECT count(*) FROM documents WHERE user_id=? AND id IS NOT ?) AS documents,(SELECT count(*) FROM tasks WHERE user_id=? AND document_id IS NOT ?) AS tasks,(SELECT count(*) FROM calendar_events WHERE user_id=? AND document_id IS NOT ?) AS events,(SELECT count(*) FROM sessions WHERE user_id=?) AS sessions,(SELECT count(*) FROM subjects WHERE user_id=?) AS subjects,(SELECT count(*) FROM class_schedules WHERE user_id=?) AS schedules`,
            [
              USER,
              documentId ?? null,
              USER,
              documentId ?? null,
              USER,
              documentId ?? null,
              USER,
              USER,
              USER,
            ],
            true,
          );
          const row = unexpected[0];
          if (
            users.length !== 1 ||
            users[0].id !== USER ||
            users[0].github_id !== GITHUB_ID ||
            users[0].github_login !== 'local' ||
            Object.values(row).some((count) => count !== 0)
          )
            throw new Error('CLEANUP_SAFETY_CHECK_REFUSED');
          await query('DELETE FROM users WHERE id=? AND github_id=?', [USER, GITHUB_ID], true);
          await query(
            'DELETE FROM rate_limits WHERE key IN (?,?)',
            [`api:read:${USER}`, `api:write:${USER}`],
            true,
          );
          if (
            (await query('SELECT id FROM users WHERE id=? OR github_id=?', [USER, GITHUB_ID], true))
              .length
          )
            throw new Error('CLEANUP_NOT_CONFIRMED');
          report.cleanup = 'isolated_fixture_user_and_cascades_deleted';
        }
      } catch (error) {
        report.cleanup =
          error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : 'CLEANUP_FAILED';
        report.status = 'failed';
      }
    }
  };
  try {
    if (process.env.FREE_PLAN_CONFIRMED !== 'true')
      throw new Error('WORKERS_FREE_CONFIRMATION_REQUIRED');
    if (
      !process.env.CLOUDFLARE_API_TOKEN ||
      !/^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID ?? '')
    )
      throw new Error('SECURE_CLOUDFLARE_ENV_REQUIRED');
    deadlineTimer = setTimeout(() => {
      deadline.abort();
      void stop();
    }, MAX_DURATION);
    const databases = await cf('/d1/database?name=studentos');
    const matches = databases.filter((database) => database.name === 'studentos');
    if (matches.length !== 1) throw new Error('ONE_EXISTING_STUDENTOS_DATABASE_REQUIRED');
    databaseId = matches[0].uuid;
    // Existing schema is required. This acceptance test never creates infrastructure or applies migrations.
    const tables = await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','documents','document_sections','agent_runs','agent_steps','analysis_results','tasks','calendar_events','ai_usage')",
    );
    if (tables.length !== 9) throw new Error('PRODUCTION_MIGRATIONS_REQUIRED');
    if ((await query('SELECT id FROM users WHERE id=? OR github_id=?', [USER, GITHUB_ID])).length)
      throw new Error('TEST_NAMESPACE_ALREADY_EXISTS_REFUSE_TO_TOUCH');
    await query('SELECT task_id FROM calendar_events LIMIT 0');
    await query('SELECT id FROM sessions LIMIT 0');
    isolatedInitially = true;
    const schema = JSON.parse(
      await readFile(resolve(root, 'node_modules/wrangler/config-schema.json'), 'utf8'),
    );
    const serializedSchema = JSON.stringify(schema);
    if (
      !serializedSchema.includes('Whether the AI binding should be remote') ||
      !serializedSchema.includes('Whether the D1 database should be remote')
    )
      throw new Error('WRANGLER_REMOTE_BINDINGS_UNSUPPORTED');
    const original = parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'), [], {
      allowTrailingComma: true,
    });
    await mkdir(dirname(temporaryConfig), { recursive: true });
    await writeFile(temporaryConfig, JSON.stringify(liveConfig(original, databaseId), null, 2), {
      mode: 0o600,
    });
    child = spawn(
      process.execPath,
      [
        resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
        'dev',
        '--config',
        temporaryConfig,
        '--ip',
        '127.0.0.1',
        '--port',
        String(PORT),
        '--show-interactive-dev-session=false',
      ],
      {
        cwd: root,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', BROWSER: 'none' },
      },
    );
    child.once('exit', () => {
      childExited = true;
    });
    child.once('error', () => {
      childExited = true;
    });
    // Retain only a bounded in-memory diagnostic buffer, never artifact/log raw CLI output.
    const collect = (chunk) => {
      childLog = (childLog + String(chunk)).slice(-32_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const readyUntil = Date.now() + 90_000;
    let ready = false;
    while (Date.now() < readyUntil && !childExited) {
      try {
        const response = await fetch(ORIGIN + '/api/health', {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok && (await response.json()).service === 'StudentOS') {
          ready = true;
          break;
        }
      } catch {
        /* startup is polled without logging CLI bodies */
      }
      await sleep(500);
    }
    if (!ready) {
      const category = /authenticat|permission|10000|authorization|not authorized/i.test(childLog)
        ? 'REMOTE_BINDINGS_PERMISSION'
        : /unknown argument|unrecognized|invalid.*config/i.test(childLog)
          ? 'WRANGLER_CONFIG'
          : 'WRANGLER_STARTUP';
      throw new Error(category);
    }
    const bootstrap = await api('/bootstrap');
    report.checks.isolated_remote_user = bootstrap.user?.id === USER;
    if (!report.checks.isolated_remote_user) throw new Error('UNEXPECTED_TEST_IDENTITY');
    const fixture = JSON.parse(await readFile(resolve(root, report.public_fixture), 'utf8'));
    const uploaded = await api('/documents', 'POST', {
      name: `LIVE AI ACCEPTANCE — PUBLIC FIXTURE — ${randomUUID()}`,
      hash: createHash('sha256').update(JSON.stringify(fixture.pages)).digest('hex'),
      academic_year: fixture.academic_year,
      subject_id: null,
      pages: fixture.pages,
    });
    documentId = uploaded.document.id;
    const started = await api(`/documents/${documentId}/analyze`, 'POST');
    runId = started.run.id;
    detail = await api(`/runs/${runId}`);
    while (!['approval', 'failed', 'committed'].includes(detail.run.state)) {
      if (detail.run.calls >= MAX_CALLS) throw new Error('ACCEPTANCE_MODEL_CALL_BUDGET_EXHAUSTED');
      const response = await api(`/runs/${runId}/advance`, 'POST');
      detail = response;
      report.orchestrator_call_reservations = detail.run.calls;
      report.stages.push({
        state: detail.run.state,
        calls: detail.run.calls,
        retries: detail.run.retries,
      });
      console.log(
        'STUDENTOS_LIVE_AI_CHECKPOINT=' +
          JSON.stringify({
            state: detail.run.state,
            calls: detail.run.calls,
            steps: detail.steps.map((step) => ({
              agent: step.agent,
              state: step.state,
              duration_ms: step.duration_ms,
              validation_json: step.validation_json,
              error: step.error,
            })),
          }),
      );
      // Each completed request must be independently recoverable from remote D1.
      const resumed = await api(`/runs/${runId}`);
      if (resumed.run.state !== detail.run.state || resumed.steps.length !== detail.steps.length)
        throw new Error('REMOTE_CHECKPOINT_MISMATCH');
      detail = resumed;
    }
    if (detail.run.state !== 'approval')
      throw new Error(`AI_RUN_${detail.run.state.toUpperCase()}`);
    const completed = detail.steps.filter((step) => step.state === 'completed');
    report.completed_model_responses = completed.length;
    report.checks.four_real_agent_roles = ['document', 'deadline', 'planner', 'review'].every(
      (role) => completed.some((step) => step.agent === role && step.model === MODEL),
    );
    if (!report.checks.four_real_agent_roles)
      throw new Error('FOUR_COMPLETED_REAL_AGENT_ROLES_REQUIRED');
    report.metrics = goldMetrics(detail.result.proposals, fixture.gold);
    const accepted = new Set(detail.result.review.accepted_ids);
    const proposals = detail.result.proposals.filter(
      (proposal) =>
        accepted.has(proposal.id) && proposal.due_date && !proposal.requires_confirmation,
    );
    if (!proposals.length) throw new Error('NO_REVIEW_ACCEPTED_DATED_PROPOSALS');
    // Acceptance does not alter model answers or silently mark ambiguous dates as confirmed.
    const selected = new Set(proposals.map((proposal) => proposal.id));
    const blocks = detail.result.blocks.filter((block) => selected.has(block.proposal_id));
    const committed = await api(`/runs/${runId}/approve`, 'POST', { proposals, blocks });
    if (committed.run.state !== 'committed') throw new Error('APPROVAL_NOT_COMMITTED');
    detail = committed;
    const [remoteRows] = await query(
      `SELECT (SELECT count(*) FROM tasks WHERE user_id=? AND document_id=?) AS tasks,(SELECT count(*) FROM calendar_events WHERE user_id=? AND document_id=?) AS events,(SELECT count(*) FROM agent_steps WHERE user_id=? AND run_id=? AND state='completed') AS completed_steps,(SELECT count(*) FROM analysis_results WHERE user_id=? AND run_id=? AND approved_at IS NOT NULL) AS approved_results`,
      [USER, documentId, USER, documentId, USER, runId, USER, runId],
    );
    report.remote_rows = remoteRows;
    report.checks.remote_d1_committed =
      remoteRows.tasks === proposals.length &&
      remoteRows.events >= proposals.length &&
      remoteRows.completed_steps >= 4 &&
      remoteRows.approved_results === 1;
    report.checks.perfect_fixture_deadline_date_precision_recall =
      report.metrics.precision === 1 && report.metrics.recall === 1;
    report.checks.refresh_retains_committed =
      (await api(`/runs/${runId}`)).run.state === 'committed';
    if (!report.checks.remote_d1_committed || !report.checks.refresh_retains_committed)
      throw new Error('REMOTE_D1_PERSISTENCE_MISMATCH');
    report.status = report.checks.perfect_fixture_deadline_date_precision_recall
      ? 'passed'
      : 'partial_extraction';
  } catch (error) {
    // Error codes/messages are ours; never serialize raw provider responses or hidden model reasoning.
    report.error =
      error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : 'LIVE_ACCEPTANCE_FAILED';
    if (detail?.run?.calls !== undefined) report.orchestrator_call_reservations = detail.run.calls;
    report.status = 'failed';
  } finally {
    clearTimeout(deadlineTimer);
    await stop();
    await cleanup();
    report.completed_model_responses =
      detail?.steps?.filter((step) => step.state === 'completed').length ?? 0;
    await rm(temporaryConfig, { force: true });
    report.finished_at = new Date().toISOString();
    report.duration_ms = Date.now() - began;
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
    if (detail)
      await writeFile(
        resolve(artifactDir, 'actual-operational-run.json'),
        JSON.stringify(operationalDetail(detail), null, 2),
      );
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `\n### Rzeczywisty test Workers AI + D1\n\nStatus: **${report.status}**. Model: ${MODEL}. Wywołania: ${report.orchestrator_call_reservations}/${MAX_CALLS}. Cleanup: ${report.cleanup}.\n\nTest używa lokalnego handlera i rzeczywistych zdalnych bindingów; nie sprawdza logowania OAuth produkcji. Metryki dotyczą wyłącznie publicznego fixture. Szczegóły w artifacts/live-ai.\n`,
      );
    console.log('STUDENTOS_LIVE_AI_ACCEPTANCE=' + JSON.stringify(report));
    childLog = '';
  }
  if (report.status !== 'passed') process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
