import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = 'https://studentos.recytator.workers.dev';
const MAX_CALLS = 5;
const SESSION_SECONDS = 600;
const MAX_DURATION = 8 * 60_000;
const ACTIVE_STATES = "('document','deadline','planner','review','approval')";
const clean = (value) => String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();

export function configuration(env) {
  if (env.FREE_PLAN_CONFIRMED !== 'true') throw new Error('WORKERS_FREE_CONFIRMATION_REQUIRED');
  if (!env.CLOUDFLARE_API_TOKEN || !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? ''))
    throw new Error('SECURE_CLOUDFLARE_ENV_REQUIRED');
  if (!/^\d+$/.test(env.GITHUB_OWNER_ID ?? '')) throw new Error('NUMERIC_EXISTING_OWNER_REQUIRED');
  if (env.APP_URL && env.APP_URL !== APP_URL) throw new Error('UNVERIFIED_PRODUCTION_ORIGIN');
  return {
    origin: APP_URL,
    ownerGithubId: env.GITHUB_OWNER_ID,
    ai: env.STUDENTOS_PRODUCTION_AI === 'true',
  };
}

/** Same opaque-token and SHA-256/base64url representation as worker/auth.ts. Never log these values. */
export function testSession(now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    digest: createHash('sha256').update(token).digest('base64url'),
    expires: Math.floor(now / 1000) + SESSION_SECONDS,
  };
}

/** Only public fixture sources and complete gold dates may become temporary test tasks. */
export function knownProposals(proposals, acceptedIds, gold, prefix, subjectId) {
  const accepted = new Set(acceptedIds);
  const seen = new Set();
  return proposals
    .filter((proposal) => {
      if (
        !accepted.has(proposal.id) ||
        !proposal.due_date ||
        proposal.requires_confirmation ||
        seen.has(proposal.id)
      )
        return false;
      const match = gold.find(
        (entry) =>
          entry.due_date === proposal.due_date &&
          proposal.sources?.some(
            (source) =>
              source.page === entry.page && clean(source.quote).includes(clean(entry.quote)),
          ),
      );
      if (!match) return false;
      seen.add(proposal.id);
      return true;
    })
    .map((proposal) => ({
      ...proposal,
      title: `${prefix} ${proposal.title}`.slice(0, 240),
      subject_id: subjectId,
    }));
}

export function safeStudyBlocks(blocks, proposals, current, prefix, now = Date.now()) {
  const selected = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const safe = [];
  const ids = new Set();
  const local = (value) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(value));
    const part = (type) => parts.find((item) => item.type === type)?.value ?? '';
    return {
      date: `${part('year')}-${part('month')}-${part('day')}`,
      time: `${part('hour')}:${part('minute')}`,
      weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(part('weekday')) + 1,
    };
  };
  const overlaps = (a, b) =>
    Date.parse(a.start_at) < Date.parse(b.end_at) && Date.parse(b.start_at) < Date.parse(a.end_at);
  for (const block of blocks) {
    const proposal = selected.get(block.proposal_id);
    if (
      !proposal?.due_date ||
      ids.has(block.id) ||
      !Number.isFinite(Date.parse(block.start_at)) ||
      !Number.isFinite(Date.parse(block.end_at)) ||
      Date.parse(block.start_at) < now ||
      Date.parse(block.end_at) <= Date.parse(block.start_at)
    )
      continue;
    const start = local(block.start_at),
      end = local(block.end_at),
      prefs = current.preferences;
    if (
      start.date !== end.date ||
      end.date > proposal.due_date ||
      !prefs.study_days.includes(start.weekday) ||
      start.time < prefs.available_from ||
      end.time > prefs.available_to ||
      current.events.some((event) => overlaps(block, event)) ||
      safe.some((other) => overlaps(block, other)) ||
      current.schedules.some(
        (schedule) =>
          schedule.weekday === start.weekday &&
          start.date >= schedule.valid_from &&
          start.date <= schedule.valid_to &&
          start.time < schedule.end_time &&
          schedule.start_time < end.time,
      )
    )
      continue;
    ids.add(block.id);
    safe.push({ ...block, title: `${prefix} ${block.title}`.slice(0, 240) });
  }
  return safe;
}

export function fixtureMetrics(proposals, gold) {
  const remaining = new Set(gold.flatMap((entry, index) => (entry.due_date ? [index] : [])));
  const dated = proposals.filter((proposal) => proposal.due_date);
  let matched = 0;
  for (const proposal of dated) {
    const index = [...remaining].find(
      (candidate) =>
        gold[candidate].due_date === proposal.due_date &&
        proposal.sources?.some(
          (source) =>
            source.page === gold[candidate].page &&
            clean(source.quote).includes(clean(gold[candidate].quote)),
        ),
    );
    if (index !== undefined) {
      remaining.delete(index);
      matched++;
    }
  }
  return {
    method:
      'Complete date AND public gold page/quote; duplicate predictions are false positives. Does not score title semantics or undated requirements.',
    expected: gold.filter((entry) => entry.due_date).length,
    predicted: dated.length,
    matched,
    precision: dated.length ? matched / dated.length : 0,
    recall: matched + remaining.size ? matched / (matched + remaining.size) : 0,
  };
}

export function hasAuthSecrets(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) =>
      /^(sessions|oauth_states|access_token|refresh_token|client_secret|github_client_secret|authorization|cookie|verifier|password)$/i.test(
        key,
      ) || hasAuthSecrets(child),
  );
}

export async function main(env = process.env) {
  const prefix = `PROD-QA-${randomUUID()}`;
  const report = {
    status: 'failed',
    started_at: new Date().toISOString(),
    origin: APP_URL,
    namespace: prefix,
    execution:
      'Actual HTTPS production Worker, static assets, D1 and optional Workers AI. A short-lived QA-issued session authenticates the existing real owner; this is NOT proof of a new OAuth login. Successful sampled requests exercised production execution limits; exact CPU time is not exposed or measured.',
    requests: [],
    checks: {},
    ai: {
      requested: env.STUDENTOS_PRODUCTION_AI === 'true',
      status: 'not_started',
      maximum_call_reservations: MAX_CALLS,
      call_reservations: 0,
      completed_agent_roles: [],
      metrics: null,
      usage_before: null,
      usage_after: null,
      remaining_daily_analyses: null,
      note: 'No AI usage reservations are refunded. Provider charges/neuron counts are not inferred from these counters.',
    },
    cleanup: { records: 'not_needed', session: 'not_created' },
    error: null,
  };
  const deadline = new AbortController();
  let cfg,
    databaseId,
    ownerId,
    session,
    sessionInserted = false,
    documentHash;
  const created = {};
  const expected = {
    subjects: `${prefix} subject`,
    tasks: `${prefix} task`,
    schedules: `${prefix} room`,
    events: `${prefix} event`,
    documents: `${prefix} public fixture`,
  };
  const timer = setTimeout(() => deadline.abort(), MAX_DURATION);
  const stop = () => deadline.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const fail = (code) => {
    throw new Error(code);
  };
  const cf = async (path, method = 'GET', data, cleanup = false) => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        signal: cleanup
          ? AbortSignal.timeout(15_000)
          : AbortSignal.any([deadline.signal, AbortSignal.timeout(30_000)]),
        redirect: 'error',
      },
    );
    const result = await response.json();
    if (!response.ok || !result.success) fail(`CLOUDFLARE_HTTP_${response.status}`);
    return result.result;
  };
  const query = async (sql, params = [], cleanup = false) => {
    if (!databaseId) fail('D1_NOT_SELECTED');
    const result = await cf(`/d1/database/${databaseId}/query`, 'POST', { sql, params }, cleanup);
    if (!Array.isArray(result) || result.some((entry) => !entry.success)) fail('D1_QUERY_FAILED');
    return result[0]?.results ?? [];
  };
  const api = async (
    path,
    method = 'GET',
    data,
    { expectedStatus = 200, anonymous = false, cleanup = false, text = false } = {},
  ) => {
    const start = Date.now();
    const response = await fetch(cfg.origin + '/api' + path, {
      method,
      headers: {
        Origin: cfg.origin,
        ...(!anonymous && session ? { Cookie: `studentos_session=${session.token}` } : {}),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: cleanup
        ? AbortSignal.timeout(12_000)
        : AbortSignal.any([
            deadline.signal,
            AbortSignal.timeout(path.endsWith('/advance') ? 195_000 : 30_000),
          ]),
      redirect: 'error',
    });
    const raw = await response.text();
    report.requests.push({
      route: path.replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, ':test-id'),
      method,
      status: response.status,
      duration_ms: Date.now() - start,
      response_bytes: Buffer.byteLength(raw),
      response_type: response.headers.get('Content-Type')?.split(';')[0] ?? null,
      cf_ray_present: Boolean(response.headers.get('cf-ray')),
    });
    if (response.status !== expectedStatus) {
      let code;
      try {
        code = JSON.parse(raw).error?.code;
      } catch {
        /* Never print response bodies containing private data or provider output. */
      }
      fail(
        `PRODUCTION_HTTP_${response.status}${typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? `_${code}` : ''}`,
      );
    }
    return text ? raw : JSON.parse(raw);
  };
  const register = (kind, row) => {
    if (!row || typeof row.id !== 'string' || row.user_id !== ownerId)
      fail('UNEXPECTED_CREATED_OWNER');
    created[kind] = row.id;
    return row;
  };
  const usageCounts = (value) => ({
    analyses: value.usage.analyses,
    calls: value.usage.calls,
    limit_analyses: value.limits.analyses,
    limit_calls: value.limits.calls,
  });
  const activeOthers = async () =>
    (
      await query(
        `SELECT count(*) AS count FROM agent_runs WHERE user_id=? AND state IN ${ACTIVE_STATES}${created.run ? ' AND id<>?' : ''}`,
        created.run ? [ownerId, created.run] : [ownerId],
      )
    )[0].count;
  const cleanupRecords = async () => {
    if (!ownerId || !databaseId) return;
    const problems = [];
    // Recover only exact unpredictable test names if an HTTP response was lost after commit.
    for (const [kind, column] of [
      ['documents', 'name'],
      ['events', 'title'],
      ['tasks', 'title'],
      ['schedules', 'location'],
      ['subjects', 'name'],
    ]) {
      const table = { events: 'calendar_events', schedules: 'class_schedules' }[kind] ?? kind;
      try {
        if (!created[kind]) {
          const rows = await query(
            `SELECT id FROM ${table} WHERE user_id=? AND ${column}=?`,
            [ownerId, expected[kind]],
            true,
          );
          if (rows.length > 1) fail('AMBIGUOUS_TEST_RECORD');
          if (rows.length) created[kind] = rows[0].id;
        }
        if (!created[kind]) continue;
        const rows = await query(
          `SELECT id,${column}${kind === 'documents' ? ',hash' : ''} FROM ${table} WHERE id=? AND user_id=?`,
          [created[kind], ownerId],
          true,
        );
        if (!rows.length) continue;
        if (
          rows[0][column] !== expected[kind] ||
          (kind === 'documents' && documentHash && rows[0].hash !== documentHash)
        )
          fail('CLEANUP_RECORD_CHANGED_REFUSED');
        if (kind === 'documents') {
          // A user may see the temporary document. Refuse deletion if they have linked unrelated work to it.
          const [foreign] = await query(
            'SELECT (SELECT count(*) FROM tasks WHERE user_id=? AND document_id=? AND substr(title,1,?)<>?) AS tasks,(SELECT count(*) FROM calendar_events WHERE user_id=? AND document_id=? AND substr(title,1,?)<>? AND substr(title,1,?)<>?) AS events',
            [
              ownerId,
              created.documents,
              prefix.length,
              prefix,
              ownerId,
              created.documents,
              `Termin: ${prefix}`.length,
              `Termin: ${prefix}`,
              prefix.length,
              prefix,
            ],
            true,
          );
          if (foreign.tasks || foreign.events) fail('CLEANUP_UNRELATED_DOCUMENT_REFERENCE_REFUSED');
        }
        if (kind === 'subjects') {
          const [refs] = await query(
            'SELECT (SELECT count(*) FROM tasks WHERE subject_id=?) AS tasks,(SELECT count(*) FROM calendar_events WHERE subject_id=?) AS events,(SELECT count(*) FROM class_schedules WHERE subject_id=?) AS schedules,(SELECT count(*) FROM documents WHERE subject_id=?) AS documents',
            [created.subjects, created.subjects, created.subjects, created.subjects],
            true,
          );
          if (Object.values(refs).some((count) => count !== 0))
            fail('CLEANUP_REMAINING_SUBJECT_REFERENCE_REFUSED');
        }
        let deleted = false;
        try {
          await api(`/${kind}/${created[kind]}`, 'DELETE', undefined, { cleanup: true });
          deleted = true;
        } catch {
          /* exact, guarded SQL fallback below; never delete by broad owner/name prefix */
        }
        if (!deleted) {
          if (kind === 'documents') {
            const [lease] = await query(
              'SELECT count(*) AS count FROM agent_runs WHERE document_id=? AND user_id=? AND lease_until>?',
              [created.documents, ownerId, Date.now()],
              true,
            );
            if (lease.count) fail('CLEANUP_ACTIVE_TEST_RUN_PENDING');
            await query(
              'DELETE FROM calendar_events WHERE user_id=? AND document_id=? AND (substr(title,1,?)=? OR substr(title,1,?)=?)',
              [
                ownerId,
                created.documents,
                `Termin: ${prefix}`.length,
                `Termin: ${prefix}`,
                prefix.length,
                prefix,
              ],
              true,
            );
            await query(
              'DELETE FROM tasks WHERE user_id=? AND document_id=? AND substr(title,1,?)=?',
              [ownerId, created.documents, prefix.length, prefix],
              true,
            );
          }
          await query(
            `DELETE FROM ${table} WHERE id=? AND user_id=? AND ${column}=?`,
            [created[kind], ownerId, expected[kind]],
            true,
          );
        }
        if (
          (
            await query(
              `SELECT id FROM ${table} WHERE id=? AND user_id=?`,
              [created[kind], ownerId],
              true,
            )
          ).length
        )
          fail('CLEANUP_RECORD_STILL_PRESENT');
      } catch (error) {
        problems.push(/^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'CLEANUP_FAILED');
      }
    }
    report.cleanup.records = problems.length ? problems : 'all_exact_test_records_deleted';
    if (problems.length) report.status = 'failed';
  };
  try {
    cfg = configuration(env);
    const matches = (await cf('/d1/database?name=studentos')).filter(
      (row) => row.name === 'studentos',
    );
    if (matches.length !== 1) fail('ONE_EXISTING_DATABASE_REQUIRED');
    databaseId = matches[0].uuid;
    if (!/^[a-f0-9-]{36}$/i.test(databaseId)) fail('INVALID_EXISTING_D1_ID');
    const owners = await query('SELECT id FROM users WHERE github_id=?', [cfg.ownerGithubId]);
    if (owners.length !== 1) fail('EXISTING_OAUTH_OWNER_REQUIRED_NO_FAKE_USER_CREATED');
    ownerId = owners[0].id;
    session = testSession();
    sessionInserted = true; // Also clean up an ambiguous network failure after an INSERT commit.
    await query('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)', [
      session.digest,
      ownerId,
      session.expires,
    ]);
    report.cleanup.session = 'temporary_session_pending';
    const me = await api('/auth/me');
    if (me.user?.id !== ownerId || me.development !== false)
      fail('REAL_OWNER_PRODUCTION_AUTH_REQUIRED');
    report.checks.production_authenticated_existing_owner = true;
    await api('/bootstrap', 'GET', undefined, { anonymous: true, expectedStatus: 401 });
    report.checks.anonymous_private_api_blocked = true;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(
      new Date(),
    );
    const later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    register(
      'subjects',
      await api(
        '/subjects',
        'POST',
        { name: expected.subjects, teacher: '', color: '#8b8cf8', class_type: 'projekt' },
        { expectedStatus: 201 },
      ),
    );
    register(
      'tasks',
      await api(
        '/tasks',
        'POST',
        { title: expected.tasks, subject_id: created.subjects, due_date: later, notes: prefix },
        { expectedStatus: 201 },
      ),
    );
    await api(`/tasks/${created.tasks}`, 'PATCH', { status: 'done' });
    const task = await api(`/tasks/${created.tasks}`);
    if (task.status !== 'done' || task.title !== expected.tasks)
      fail('TASK_REFRESH_PERSISTENCE_FAILED');
    register(
      'schedules',
      await api(
        '/schedules',
        'POST',
        {
          subject_id: created.subjects,
          weekday: 1,
          start_time: '09:00',
          end_time: '09:30',
          valid_from: today,
          valid_to: later,
          location: expected.schedules,
        },
        { expectedStatus: 201 },
      ),
    );
    const start = new Date(Date.now() + 3 * 86400000);
    register(
      'events',
      await api(
        '/events',
        'POST',
        {
          title: expected.events,
          subject_id: created.subjects,
          start_at: start.toISOString(),
          end_at: new Date(start.valueOf() + 30 * 60000).toISOString(),
          location: prefix,
        },
        { expectedStatus: 201 },
      ),
    );
    const refreshed = await api('/bootstrap');
    for (const kind of ['subjects', 'tasks', 'schedules', 'events'])
      if (!refreshed[kind]?.some((row) => row.id === created[kind]))
        fail('BOOTSTRAP_CREATED_RECORD_MISSING');
    report.checks.crud_persisted_after_fresh_bootstrap = true;
    const ics = await api('/export.ics', 'GET', undefined, { text: true });
    if (
      !ics.includes('BEGIN:VCALENDAR') ||
      !ics.includes(expected.events) ||
      !ics.includes('RRULE:FREQ=WEEKLY')
    )
      fail('ICS_EXPORT_FAILED');
    const exported = await api('/export');
    if (
      hasAuthSecrets(exported) ||
      !exported.tasks?.some((row) => row.id === created.tasks) ||
      !exported.subjects?.some((row) => row.id === created.subjects)
    )
      fail('JSON_EXPORT_UNSAFE_OR_MISSING_TEST_DATA');
    report.checks.exports_ics_json_without_auth_secret_fields = true;
    report.status = 'passed_crud';
    if (cfg.ai) {
      const before = await api('/usage');
      report.ai.usage_before = usageCounts(before);
      if (!refreshed.preferences?.ai_enabled) report.ai.status = 'skipped_owner_disabled_ai';
      else if (
        before.usage.analyses >= before.limits.analyses ||
        before.usage.calls + MAX_CALLS > before.limits.calls
      )
        report.ai.status = 'skipped_owner_daily_budget';
      else if (await activeOthers()) report.ai.status = 'skipped_owner_has_active_run';
      else {
        const fixture = JSON.parse(
          await readFile(resolve(ROOT, 'tests/fixtures/syllabus-exact.json'), 'utf8'),
        );
        const pages = fixture.pages.map((page, index) => ({
          ...page,
          text:
            page.text +
            (index === fixture.pages.length - 1 ? `\nPublic QA namespace: ${prefix}.` : ''),
        }));
        documentHash = createHash('sha256').update(JSON.stringify(pages)).digest('hex');
        const imported = await api(
          '/documents',
          'POST',
          {
            name: expected.documents,
            hash: documentHash,
            academic_year: fixture.academic_year,
            subject_id: created.subjects,
            pages,
          },
          { expectedStatus: 201 },
        );
        if (imported.cached) fail('UNIQUE_PUBLIC_FIXTURE_REQUIRED');
        register('documents', imported.document);
        if (await activeOthers()) report.ai.status = 'skipped_owner_started_run_concurrently';
        else {
          report.ai.status = 'running';
          const started = await api(`/documents/${created.documents}/analyze`, 'POST');
          if (started.cached || started.run.document_id !== created.documents)
            fail('NEW_TEST_RUN_REQUIRED');
          created.run = started.run.id;
          let detail = await api(`/runs/${created.run}`);
          while (!['approval', 'committed', 'failed'].includes(detail.run.state)) {
            if (await activeOthers()) fail('OWNER_STARTED_CONCURRENT_RUN_STOPPING_AI');
            if (detail.run.calls >= MAX_CALLS) fail('PRODUCTION_AI_CALL_BUDGET_EXHAUSTED');
            detail = await api(`/runs/${created.run}/advance`, 'POST');
            report.ai.call_reservations = detail.run.calls;
            const resumed = await api(`/runs/${created.run}`);
            if (
              resumed.run.state !== detail.run.state ||
              resumed.steps.length !== detail.steps.length
            )
              fail('PRODUCTION_CHECKPOINT_NOT_PERSISTED');
            detail = resumed;
          }
          if (detail.run.state !== 'approval') fail('PRODUCTION_AI_RUN_FAILED');
          report.ai.completed_agent_roles = [
            ...new Set(
              detail.steps.filter((step) => step.state === 'completed').map((step) => step.agent),
            ),
          ];
          if (
            !['document', 'deadline', 'planner', 'review'].every((role) =>
              report.ai.completed_agent_roles.includes(role),
            )
          )
            fail('FOUR_PRODUCTION_AGENT_ROLES_REQUIRED');
          report.ai.model = detail.run.model;
          report.ai.metrics = fixtureMetrics(detail.result.proposals, fixture.gold);
          // Namespace task titles to avoid deduplicating against the owner's genuine work. No date/source/confirmation is altered.
          const proposals = knownProposals(
            detail.result.proposals,
            detail.result.review.accepted_ids,
            fixture.gold,
            prefix,
            created.subjects,
          );
          if (!proposals.length) fail('NO_GOLD_AND_REVIEW_ACCEPTED_PRODUCTION_PROPOSALS');
          const current = await api('/bootstrap');
          const blocks = safeStudyBlocks(detail.result.blocks, proposals, current, prefix);
          await api(`/runs/${created.run}/approve`, 'POST', { proposals, blocks });
          const persisted = await api(`/runs/${created.run}`);
          const [rows] = await query(
            'SELECT (SELECT count(*) FROM tasks WHERE user_id=? AND document_id=? AND substr(title,1,?)=?) AS tasks,(SELECT count(*) FROM calendar_events WHERE user_id=? AND document_id=? AND substr(title,1,?)=?) AS deadlines,(SELECT count(*) FROM calendar_events WHERE user_id=? AND document_id=? AND substr(title,1,?)=?) AS study_blocks,(SELECT count(*) FROM analysis_results WHERE run_id=? AND user_id=? AND approved_at IS NOT NULL) AS approvals',
            [
              ownerId,
              created.documents,
              prefix.length,
              prefix,
              ownerId,
              created.documents,
              `Termin: ${prefix}`.length,
              `Termin: ${prefix}`,
              ownerId,
              created.documents,
              prefix.length,
              prefix,
              created.run,
              ownerId,
            ],
          );
          if (
            persisted.run.state !== 'committed' ||
            rows.tasks !== proposals.length ||
            rows.deadlines !== proposals.length ||
            rows.study_blocks !== blocks.length ||
            rows.approvals !== 1
          )
            fail('PRODUCTION_APPROVAL_D1_MISMATCH');
          report.ai.committed_test_tasks = rows.tasks;
          report.ai.committed_test_events = rows.deadlines + rows.study_blocks;
          report.ai.committed_test_study_blocks = blocks.length;
          report.ai.operational_steps = persisted.steps.map((step) => ({
            agent: step.agent,
            state: step.state,
            model: step.model,
            duration_ms: step.duration_ms,
            attempt: step.attempt,
            input_tokens: step.input_tokens,
            output_tokens: step.output_tokens,
          }));
          report.ai.status =
            report.ai.metrics.precision === 1 && report.ai.metrics.recall === 1
              ? 'passed'
              : 'partial_extraction';
          report.status = report.ai.status === 'passed' ? 'passed' : 'partial_extraction';
        }
      }
      if (report.ai.status.startsWith('skipped')) report.status = 'passed_crud_ai_skipped';
    } else report.ai.status = 'not_requested';
  } catch (error) {
    report.status = 'failed';
    if (report.ai.status === 'running') report.ai.status = 'failed';
    report.error = /^[A-Z0-9_]+$/.test(error?.message ?? '')
      ? error.message
      : deadline.signal.aborted
        ? 'PRODUCTION_ACCEPTANCE_TIMEOUT'
        : 'PRODUCTION_ACCEPTANCE_FAILED';
  } finally {
    clearTimeout(timer);
    if (created.run && ownerId) {
      try {
        const [run] = await query(
          'SELECT calls FROM agent_runs WHERE id=? AND user_id=?',
          [created.run, ownerId],
          true,
        );
        if (run) report.ai.call_reservations = run.calls;
      } catch {
        /* Keep the last confirmed reservation count if remote metadata is unavailable. */
      }
    }
    await cleanupRecords();
    if (ownerId && sessionInserted) {
      try {
        const after = await api('/usage', 'GET', undefined, { cleanup: true });
        report.ai.usage_after = usageCounts(after);
        report.ai.remaining_daily_analyses = Math.max(
          0,
          after.limits.analyses - after.usage.analyses,
        );
      } catch {
        /* no invented usage values when the session or API is unavailable */
      }
      try {
        // Logout only the minted QA cookie, leaving the owner's browser sessions untouched.
        await api('/auth/logout', 'POST', undefined, { cleanup: true });
        await api('/auth/me', 'GET', undefined, { cleanup: true, expectedStatus: 401 });
        report.checks.temporary_session_logout_revoked = true;
      } catch {
        report.checks.temporary_session_logout_revoked = false;
        report.status = 'failed';
      }
      try {
        await query(
          'DELETE FROM sessions WHERE id=? AND user_id=?',
          [session.digest, ownerId],
          true,
        );
        if (
          (
            await query(
              'SELECT id FROM sessions WHERE id=? AND user_id=?',
              [session.digest, ownerId],
              true,
            )
          ).length
        )
          fail('TEST_SESSION_CLEANUP_FAILED');
        report.cleanup.session = 'only_exact_temporary_session_deleted';
      } catch {
        report.cleanup.session = 'temporary_session_cleanup_failed_expires_after_10_minutes';
        report.status = 'failed';
      }
    }
    session = undefined;
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    report.finished_at = new Date().toISOString();
    const directory = resolve(ROOT, 'artifacts/production-acceptance');
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    if (env.GITHUB_STEP_SUMMARY)
      await appendFile(
        env.GITHUB_STEP_SUMMARY,
        `\n### Rzeczywisty test HTTPS produkcji StudentOS\n\nStatus: **${report.status}**. CRUD: ${Boolean(report.checks.crud_persisted_after_fresh_bootstrap)}. AI: **${report.ai.status}**, rezerwacje wywołań ${report.ai.call_reservations}/${MAX_CALLS}. Pozostałe analizy właściciela dzisiaj: ${report.ai.remaining_daily_analyses ?? 'brak odczytu'}. Cleanup: ${JSON.stringify(report.cleanup)}.\n\nSesję QA wydano tymczasowo istniejącemu właścicielowi; test nie udaje logowania OAuth. Nie odczytujemy dokładnego CPU ani neuronów dostawcy. Artefakt zawiera tylko statusy i metadane testu, bez danych właściciela, cookies i odpowiedzi modeli.\n`,
      );
    console.log('STUDENTOS_PRODUCTION_ACCEPTANCE=' + JSON.stringify(report));
  }
  if (!['passed', 'passed_crud', 'passed_crud_ai_skipped'].includes(report.status))
    process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
