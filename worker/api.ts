import { z } from 'zod';
import {
  subjectInputSchema,
  taskInputSchema,
  eventInputSchema,
  scheduleInputSchema,
  subtaskInputSchema,
  preferencesInputSchema,
} from '../shared/contracts';
import { HttpError, json, readJson, type Env, type User } from './types';
import { nextDate, warsawMidnight } from '../shared/time';

const collections = {
  subjects: { table: 'subjects', schema: subjectInputSchema },
  tasks: { table: 'tasks', schema: taskInputSchema },
  events: { table: 'calendar_events', schema: eventInputSchema },
  schedules: { table: 'class_schedules', schema: scheduleInputSchema },
} as const;
type Collection = keyof typeof collections;
type Row = Record<string, unknown>;

export async function preferences(
  env: Env,
  userId: string,
): Promise<z.infer<typeof preferencesInputSchema>> {
  const record = await env.DB.prepare('SELECT value_json FROM user_preferences WHERE user_id=?')
    .bind(userId)
    .first<{ value_json: string }>();
  if (!record) return preferencesInputSchema.parse({});
  const parsed = preferencesInputSchema.safeParse(JSON.parse(record.value_json));
  return parsed.success ? parsed.data : preferencesInputSchema.parse({});
}
async function list(env: Env, userId: string, table: string): Promise<Row[]> {
  const result = await env.DB.prepare(`SELECT * FROM ${table} WHERE user_id=? ORDER BY rowid DESC`)
    .bind(userId)
    .all<Row>();
  return result.results;
}
async function owned(env: Env, userId: string, table: string, id: string): Promise<Row> {
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=?`)
    .bind(id, userId)
    .first<Row>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Nie znaleziono rekordu.');
  return row;
}
async function validateRelations(env: Env, userId: string, input: Row): Promise<void> {
  if (typeof input.subject_id === 'string') await owned(env, userId, 'subjects', input.subject_id);
  if (typeof input.document_id === 'string')
    await owned(env, userId, 'documents', input.document_id);
  if (
    typeof input.start_at === 'string' &&
    typeof input.end_at === 'string' &&
    Date.parse(input.end_at) <= Date.parse(input.start_at)
  )
    throw new HttpError(
      400,
      'INVALID_RANGE',
      'Koniec wydarzenia musi być późniejszy niż początek.',
    );
  if (
    typeof input.start_time === 'string' &&
    typeof input.end_time === 'string' &&
    input.end_time <= input.start_time
  )
    throw new HttpError(400, 'INVALID_RANGE', 'Koniec zajęć musi być późniejszy niż początek.');
  if (
    typeof input.valid_from === 'string' &&
    typeof input.valid_to === 'string' &&
    input.valid_to < input.valid_from
  )
    throw new HttpError(400, 'INVALID_RANGE', 'Koniec cyklu zajęć nie może poprzedzać początku.');
}
const deadlineKind = "substr(proposal_id,instr(proposal_id,':')+1,4)='due-'";
const blockKind = "substr(proposal_id,instr(proposal_id,':')+1,6)='block-'";

function provenance(row: Row): Record<string, unknown> | null {
  if (typeof row.proposal_id !== 'string' || typeof row.notes !== 'string') return null;
  try {
    const value: unknown = JSON.parse(row.notes);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function patchTask(
  env: Env,
  userId: string,
  taskId: string,
  previous: Row,
  input: Row,
): Promise<Response> {
  const changedDate = Object.hasOwn(input, 'due_date') && input.due_date !== previous.due_date;
  const generated = typeof previous.proposal_id === 'string';
  const warnings =
    changedDate && generated
      ? ['Zmieniono termin. Poprzednie bloki nauki usunięto; zaplanuj je ponownie.']
      : [];
  const source = provenance(previous);
  if (source) {
    // Client edits only personal notes. Source, run and date provenance remain server-controlled.
    if (typeof input.notes === 'string') {
      let userNotes = input.notes;
      try {
        const candidate: unknown = JSON.parse(input.notes);
        if (
          candidate &&
          typeof candidate === 'object' &&
          !Array.isArray(candidate) &&
          ['user_notes', 'sources', 'run_id', 'date_origin'].some((key) =>
            Object.hasOwn(candidate, key),
          )
        ) {
          userNotes =
            typeof (candidate as Record<string, unknown>).user_notes === 'string'
              ? String((candidate as Record<string, unknown>).user_notes)
              : String(source.user_notes || '');
        }
      } catch {
        /* Plain text is the normal notes-editing contract. */
      }
      source.user_notes = userNotes;
    }
    if (changedDate) {
      source.date_origin = 'user_confirmed';
      source.warning = 'Termin zmieniony przez użytkownika; sprawdź aktualność źródeł.';
      source.planning_status = 'needs_replanning';
      source.planning_warning = warnings[0];
    }
    input.notes = JSON.stringify(source);
    if (Object.hasOwn(input, 'document_id') && input.document_id !== previous.document_id) {
      throw new HttpError(
        422,
        'IMMUTABLE_SOURCE',
        'Dokument źródłowy zadania z analizy nie może zostać zmieniony.',
      );
    }
  }
  const fields = Object.entries(input);
  if (!fields.length) return json(previous);
  const updatedAt = new Date(
    Math.max(Date.now(), Date.parse(String(previous.updated_at)) + 1),
  ).toISOString();
  const statements = [
    env.DB.prepare(
      `UPDATE tasks SET ${fields.map(([key]) => `${key}=?`).join(',')},updated_at=? WHERE id=? AND user_id=? AND updated_at=?`,
    ).bind(...fields.map(([, value]) => value), updatedAt, taskId, userId, previous.updated_at),
  ];
  const guard = 'EXISTS(SELECT 1 FROM tasks WHERE id=? AND user_id=? AND updated_at=?)';
  if (generated) {
    const current = { ...previous, ...input };
    if (changedDate)
      statements.push(
        env.DB.prepare(
          `DELETE FROM calendar_events WHERE user_id=? AND task_id=? AND ${blockKind} AND ${guard}`,
        ).bind(userId, taskId, taskId, userId, updatedAt),
      );
    if (Object.hasOwn(input, 'subject_id'))
      statements.push(
        env.DB.prepare(
          `UPDATE calendar_events SET subject_id=?,updated_at=? WHERE user_id=? AND task_id=? AND ${blockKind} AND ${guard}`,
        ).bind(current.subject_id, updatedAt, userId, taskId, taskId, userId, updatedAt),
      );
    if (!current.due_date) {
      statements.push(
        env.DB.prepare(
          `DELETE FROM calendar_events WHERE user_id=? AND task_id=? AND ${deadlineKind} AND ${guard}`,
        ).bind(userId, taskId, taskId, userId, updatedAt),
      );
    } else {
      const due = String(current.due_date);
      statements.push(
        env.DB.prepare(
          `UPDATE calendar_events SET title=?,subject_id=?,start_at=?,end_at=?,updated_at=? WHERE user_id=? AND task_id=? AND ${deadlineKind} AND ${guard}`,
        ).bind(
          `Termin: ${String(current.title)}`,
          current.subject_id,
          warsawMidnight(due),
          warsawMidnight(nextDate(due)),
          updatedAt,
          userId,
          taskId,
          taskId,
          userId,
          updatedAt,
        ),
      );
      const namespace = String(previous.proposal_id);
      const colon = namespace.indexOf(':');
      if (colon > 0) {
        const runId = namespace.slice(0, colon),
          proposalId = namespace.slice(colon + 1);
        statements.push(
          env.DB.prepare(
            `INSERT INTO calendar_events(id,user_id,task_id,document_id,subject_id,title,start_at,end_at,location,proposal_id)
          SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard} AND NOT EXISTS(SELECT 1 FROM calendar_events WHERE user_id=? AND task_id=? AND ${deadlineKind})`,
          ).bind(
            `event-${runId}-${proposalId}`,
            userId,
            taskId,
            current.document_id,
            current.subject_id,
            `Termin: ${String(current.title)}`,
            warsawMidnight(due),
            warsawMidnight(nextDate(due)),
            'Termin dzienny — dokument nie określa godziny',
            `${runId}:due-${proposalId}`,
            taskId,
            userId,
            updatedAt,
            userId,
            taskId,
          ),
        );
      }
    }
  }
  const result = await env.DB.batch(statements);
  if (!result[0]?.meta.changes)
    throw new HttpError(
      409,
      'STALE_TASK',
      'Zadanie zmieniło się na innym urządzeniu. Odśwież dane i ponów edycję.',
    );
  return json({
    ...(await owned(env, userId, 'tasks', taskId)),
    ...(warnings.length ? { warnings } : {}),
  });
}

function escaped(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}
function utc(value: string): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}
function fold(line: string): string {
  const lines: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const length = new TextEncoder().encode(char).length;
    if (bytes + length > 74) {
      lines.push(current);
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += length;
  }
  lines.push(current);
  return lines.join('\r\n');
}
function ics(events: Row[], schedules: Row[], subjects: Row[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StudentOS//StudentOS PL//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-TIMEZONE:Europe/Warsaw',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Warsaw',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700329T020000',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'DTSTART:19701025T030000',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const event of events)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escaped(event.id)}@studentos`,
      `DTSTAMP:${utc(new Date().toISOString())}`,
      `DTSTART:${utc(String(event.start_at))}`,
      `DTEND:${utc(String(event.end_at))}`,
      `SUMMARY:${escaped(event.title)}`,
      `LOCATION:${escaped(event.location)}`,
      'END:VEVENT',
    );
  const weekdays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  for (const schedule of schedules) {
    const first = new Date(`${String(schedule.valid_from)}T12:00:00Z`);
    const delta = (Number(schedule.weekday) - (first.getUTCDay() || 7) + 7) % 7;
    first.setUTCDate(first.getUTCDate() + delta);
    if (first.toISOString().slice(0, 10) > String(schedule.valid_to)) continue;
    const day = first.toISOString().slice(0, 10).replace(/-/g, '');
    const subject = subjects.find((s) => s.id === schedule.subject_id);
    // COUNT includes only occurrences inside the inclusive validity interval, avoiding UTC/DST UNTIL ambiguity.
    const count =
      Math.floor(
        (new Date(`${String(schedule.valid_to)}T12:00:00Z`).valueOf() - first.valueOf()) /
          (7 * 86400000),
      ) + 1;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escaped(schedule.id)}@studentos`,
      `DTSTAMP:${utc(new Date().toISOString())}`,
      `DTSTART;TZID=Europe/Warsaw:${day}T${String(schedule.start_time).replace(':', '')}00`,
      `DTEND;TZID=Europe/Warsaw:${day}T${String(schedule.end_time).replace(':', '')}00`,
      `RRULE:FREQ=WEEKLY;BYDAY=${weekdays[Number(schedule.weekday) - 1]};COUNT=${count}`,
      `SUMMARY:${escaped(subject?.name || 'Zajęcia')}`,
      `LOCATION:${escaped(schedule.location)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export async function handleApi(request: Request, env: Env, user: User): Promise<Response | null> {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const resource = parts[1];
  const id = parts[2];
  if (resource === 'bootstrap' && request.method === 'GET') {
    const timetables = (await list(env, user.id, 'semester_timetables')).map((record) => ({
      id: record.id,
      ...JSON.parse(String(record.data_json)),
    }));
    const [subjects, tasks, events, schedules, documents, runs, prefs, subtasks] =
      await Promise.all([
        list(env, user.id, 'subjects'),
        list(env, user.id, 'tasks'),
        list(env, user.id, 'calendar_events'),
        list(env, user.id, 'class_schedules'),
        env.DB.prepare(
          'SELECT id,user_id,subject_id,name,hash,page_count,text_length,academic_year,created_at,updated_at FROM documents WHERE user_id=? ORDER BY created_at DESC LIMIT 1000',
        )
          .bind(user.id)
          .all<Row>()
          .then((r) => r.results),
        env.DB.prepare(
          'SELECT id,user_id,document_id,state,model,calls,retries,error,created_at,updated_at FROM agent_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 1000',
        )
          .bind(user.id)
          .all<Row>()
          .then((r) => r.results),
        preferences(env, user.id),
        list(env, user.id, 'subtasks'),
      ]);
    return json({
      user,
      subjects,
      tasks,
      events,
      schedules,
      timetables,
      documents,
      runs,
      preferences: prefs,
      subtasks,
    });
  }
  if (resource === 'preferences') {
    if (request.method === 'GET') return json(await preferences(env, user.id));
    if (request.method === 'PUT') {
      const input = preferencesInputSchema.parse(await readJson(request));
      if (input.available_to <= input.available_from)
        throw new HttpError(
          400,
          'INVALID_RANGE',
          'Koniec dostępności musi być późniejszy niż początek.',
        );
      const [start, end] = input.academic_year.split('/').map(Number);
      if (end !== start! + 1)
        throw new HttpError(400, 'ACADEMIC_YEAR', 'Rok akademicki musi obejmować kolejne lata.');
      await env.DB.prepare(
        `INSERT INTO user_preferences(user_id,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
      )
        .bind(user.id, JSON.stringify(input), new Date().toISOString())
        .run();
      return json(input);
    }
  }
  if (resource === 'export' && request.method === 'GET') {
    const tables = [
      'subjects',
      'tasks',
      'subtasks',
      'calendar_events',
      'class_schedules',
      'semester_timetables',
      'documents',
      'document_sections',
      'analysis_results',
      'agent_runs',
      'agent_steps',
    ];
    const data: Record<string, unknown> = {
      version: 1,
      exported_at: new Date().toISOString(),
      user,
      preferences: await preferences(env, user.id),
    };
    await Promise.all(
      tables.map(async (table) => {
        data[table] = await list(env, user.id, table);
      }),
    );
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="studentos-export.json"',
        'Cache-Control': 'no-store',
      },
    });
  }
  if (resource === 'export.ics' && request.method === 'GET') {
    const [events, schedules, subjects] = await Promise.all([
      list(env, user.id, 'calendar_events'),
      list(env, user.id, 'class_schedules'),
      list(env, user.id, 'subjects'),
    ]);
    return new Response(ics(events, schedules, subjects), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="studentos.ics"',
        'Cache-Control': 'no-store',
      },
    });
  }
  if (resource === 'data' && request.method === 'DELETE') {
    await env.DB.batch(
      [
        'subjects',
        'documents',
        'agent_runs',
        'tasks',
        'calendar_events',
        'class_schedules',
        'semester_timetables',
        'user_preferences',
      ].map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(user.id)),
    );
    return json({ ok: true });
  }
  if (resource === 'tasks' && id && parts[3] === 'subtasks') {
    await owned(env, user.id, 'tasks', id);
    const subId = parts[4];
    if (!subId && request.method === 'GET')
      return json({
        items: (
          await env.DB.prepare(
            'SELECT * FROM subtasks WHERE task_id=? AND user_id=? ORDER BY position,created_at',
          )
            .bind(id, user.id)
            .all()
        ).results,
      });
    if (!subId && request.method === 'POST') {
      const input = subtaskInputSchema.parse(await readJson(request));
      const newId = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO subtasks(id,user_id,task_id,title,status,position) VALUES(?,?,?,?,?,?)',
      )
        .bind(newId, user.id, id, input.title, input.status, input.position)
        .run();
      return json(await owned(env, user.id, 'subtasks', newId), 201);
    }
    if (subId) {
      const previous = await owned(env, user.id, 'subtasks', subId);
      if (previous.task_id !== id)
        throw new HttpError(404, 'NOT_FOUND', 'Nie znaleziono podzadania.');
      if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM subtasks WHERE id=? AND user_id=? AND task_id=?')
          .bind(subId, user.id, id)
          .run();
        return json({ ok: true });
      }
      if (request.method === 'PATCH') {
        const input = subtaskInputSchema.partial().parse(await readJson(request));
        const fields = Object.entries(input);
        if (fields.length)
          await env.DB.prepare(
            `UPDATE subtasks SET ${fields.map(([key]) => `${key}=?`).join(',')},updated_at=? WHERE id=? AND user_id=? AND task_id=?`,
          )
            .bind(...fields.map(([, v]) => v), new Date().toISOString(), subId, user.id, id)
            .run();
        return json(await owned(env, user.id, 'subtasks', subId));
      }
    }
  }
  if (!Object.hasOwn(collections, resource) || parts.length > 3) return null;
  const collection = collections[resource as Collection];
  if (!id && request.method === 'GET')
    return json({ items: await list(env, user.id, collection.table) });
  if (id && request.method === 'GET') return json(await owned(env, user.id, collection.table, id));
  if (!id && request.method === 'POST') {
    const input = collection.schema.parse(await readJson(request));
    await validateRelations(env, user.id, input);
    const fields = Object.entries(input);
    const newId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO ${collection.table}(id,user_id,${fields.map(([key]) => key).join(',')}) VALUES(?,?,${fields.map(() => '?').join(',')})`,
    )
      .bind(newId, user.id, ...fields.map(([, v]) => v))
      .run();
    return json(await owned(env, user.id, collection.table, newId), 201);
  }
  if (id && request.method === 'PATCH') {
    const previous = await owned(env, user.id, collection.table, id);
    const input = collection.schema.partial().parse(await readJson(request));
    await validateRelations(env, user.id, { ...previous, ...input });
    if (resource === 'tasks') return patchTask(env, user.id, id, previous, input);
    const fields = Object.entries(input);
    if (fields.length)
      await env.DB.prepare(
        `UPDATE ${collection.table} SET ${fields.map(([key]) => `${key}=?`).join(',')},updated_at=? WHERE id=? AND user_id=?`,
      )
        .bind(...fields.map(([, v]) => v), new Date().toISOString(), id, user.id)
        .run();
    return json(await owned(env, user.id, collection.table, id));
  }
  if (id && request.method === 'DELETE') {
    await owned(env, user.id, collection.table, id);
    await env.DB.prepare(`DELETE FROM ${collection.table} WHERE id=? AND user_id=?`)
      .bind(id, user.id)
      .run();
    return json({ ok: true });
  }
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Niedozwolona metoda.');
}
