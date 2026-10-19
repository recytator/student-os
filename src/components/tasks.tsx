import { Check, CornerDownLeft, FileText, ListChecks, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { cn } from '../lib/cn';
import { parseQuickTask } from '../lib/quickadd';
import { isDone } from '../lib/schedule';
import { useStore, type TaskDraft } from '../lib/store';
import { countdown, daysBetween, fmt, relativeDay, todayKey } from '../lib/time';
import type { Subtask, Task, TaskKind } from '../lib/types';
import { Badge, Button, Field, Modal, Segmented, SubjectDot, useFeedback } from './ui';

export const KIND_LABEL: Record<TaskKind, string> = {
  task: 'Zadanie',
  exam: 'Egzamin',
  colloquium: 'Kolokwium',
  project: 'Projekt',
};
export const KIND_TONE: Record<TaskKind, 'neutral' | 'red' | 'amber' | 'blue'> = {
  task: 'neutral',
  exam: 'red',
  colloquium: 'amber',
  project: 'blue',
};
export const PRIORITY_LABEL = { low: 'Niski', medium: 'Normalny', high: 'Wysoki' } as const;

/** Task notes from an analysis are JSON with sources; manual notes are plain text. */
export function taskMetadata(notes?: string) {
  if (!notes) return null;
  try {
    const value = JSON.parse(notes) as Record<string, unknown>;
    if (value && Array.isArray(value.sources))
      return {
        sources: (value.sources as { page: number; quote: string }[]).filter(
          (source) => typeof source?.page === 'number' && typeof source?.quote === 'string',
        ),
        user_notes: typeof value.user_notes === 'string' ? value.user_notes : '',
        warning: typeof value.warning === 'string' ? value.warning : undefined,
      };
  } catch {
    /* Plain-text notes. */
  }
  return null;
}

export function DueLabel({ task }: { task: Task }) {
  if (!task.due_date) return <span className="due due-none">Bez terminu</span>;
  const diff = daysBetween(todayKey(), task.due_date);
  const done = isDone(task);
  return (
    <span
      className={cn(
        'due',
        !done && diff < 0 && 'due-overdue',
        !done && diff <= 1 && diff >= 0 && 'due-soon',
      )}
      title={fmt.numeric(task.due_date)}
    >
      {relativeDay(task.due_date)}
    </span>
  );
}

export function TaskRow({ task, showSubject = true }: { task: Task; showSubject?: boolean }) {
  const { subject, editTask, setTaskStatus, data } = useStore();
  const done = isDone(task);
  const item = subject(task.subject_id);
  const subtasks = data.subtasks.filter((sub) => sub.task_id === task.id);
  const doneSubtasks = subtasks.filter((sub) => sub.status === 'done').length;
  const source = taskMetadata(task.notes)?.sources[0];
  return (
    <div className={cn('task-row', done && 'is-done')}>
      <button
        type="button"
        className="check"
        aria-label={done ? 'Oznacz jako niewykonane' : 'Ukończ zadanie'}
        aria-pressed={done}
        onClick={() => setTaskStatus(task, done ? 'todo' : 'done')}
      >
        {done && <Check size={12} strokeWidth={3} />}
      </button>
      <button type="button" className="task-body" onClick={() => editTask(task)}>
        <span className="task-title">
          {task.kind !== 'task' && (
            <Badge tone={KIND_TONE[task.kind]} className="kind-badge">
              {KIND_LABEL[task.kind]}
            </Badge>
          )}
          {task.title}
        </span>
        <span className="task-meta">
          {showSubject && item && (
            <span className="meta-item">
              <SubjectDot color={item.color} />
              {item.name}
            </span>
          )}
          {subtasks.length > 0 && (
            <span className="meta-item">
              <ListChecks size={12} />
              {doneSubtasks}/{subtasks.length}
            </span>
          )}
          {source && (
            <span className="meta-item">
              <FileText size={12} />
              s. {source.page}
            </span>
          )}
          {task.priority === 'high' && (
            <span className="meta-item priority-high">Wysoki priorytet</span>
          )}
        </span>
      </button>
      <DueLabel task={task} />
    </div>
  );
}

export function QuickAdd({
  draft,
  placeholder = 'Dodaj zadanie… np. „Kolokwium z UAV pt”, „Projekt 12.11 #chmury”',
  autoFocus,
}: {
  draft?: TaskDraft;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { data, call } = useStore();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => parseQuickTask(value, data.subjects), [value, data.subjects]);
  const subjectId = parsed.subject_id ?? draft?.subject_id ?? null;
  const subjectName = data.subjects.find((s) => s.id === subjectId)?.name;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsed.title || saving) return;
    setSaving(true);
    try {
      await call('/tasks', 'POST', {
        title: parsed.title,
        kind: draft?.kind && parsed.kind === 'task' ? draft.kind : parsed.kind,
        priority: parsed.priority,
        due_date: parsed.due_date ?? draft?.due_date ?? null,
        subject_id: subjectId,
      });
      setValue('');
    } catch {
      /* Toast already shown. */
    } finally {
      setSaving(false);
    }
  };
  const hasHints =
    value.trim() &&
    (parsed.due_date || subjectName || parsed.kind !== 'task' || parsed.priority === 'high');
  return (
    <form className="quick-add" onSubmit={submit}>
      <Plus size={16} className="quick-add-icon" />
      <input
        aria-label="Szybkie dodawanie zadania"
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => setValue(event.target.value)}
        maxLength={240}
      />
      {hasHints && (
        <span className="quick-hints">
          {parsed.kind !== 'task' && (
            <Badge tone={KIND_TONE[parsed.kind]}>{KIND_LABEL[parsed.kind]}</Badge>
          )}
          {parsed.due_date && <Badge tone="accent">{relativeDay(parsed.due_date)}</Badge>}
          {subjectName && <Badge>{subjectName}</Badge>}
          {parsed.priority === 'high' && <Badge tone="red">!</Badge>}
        </span>
      )}
      {value.trim() && (
        <button type="submit" className="quick-submit" aria-label="Dodaj zadanie" disabled={saving}>
          <CornerDownLeft size={14} />
        </button>
      )}
    </form>
  );
}

export function TaskEditor({
  task,
  draft,
  onClose,
}: {
  task: Task | 'new';
  draft?: TaskDraft;
  onClose: () => void;
}) {
  const { data, call, go } = useStore();
  const { confirm } = useFeedback();
  const existing = task === 'new' ? null : task;
  const metadata = taskMetadata(existing?.notes);
  const [kind, setKind] = useState<TaskKind>(existing?.kind ?? draft?.kind ?? 'task');
  const [saving, setSaving] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>(() =>
    existing ? data.subtasks.filter((sub) => sub.task_id === existing.id) : [],
  );
  const [newSubtask, setNewSubtask] = useState('');
  const reload = () => {
    if (existing)
      void api<{ items: Subtask[] }>(`/tasks/${existing.id}/subtasks`)
        .then((result) => setSubtasks(result.items))
        .catch(() => undefined);
  };
  useEffect(reload, [existing?.id]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await call(existing ? `/tasks/${existing.id}` : '/tasks', existing ? 'PATCH' : 'POST', {
        title: form.get('title'),
        notes: String(form.get('notes') ?? ''),
        subject_id: form.get('subject_id') || null,
        priority: form.get('priority'),
        due_date: form.get('due_date') || null,
        kind,
        ...(existing ? {} : { status: 'todo' }),
      });
      onClose();
    } catch {
      setSaving(false);
    }
  };
  const due = existing?.due_date ?? draft?.due_date;
  return (
    <Modal
      title={existing ? 'Edytuj zadanie' : 'Nowe zadanie'}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <Button
              variant="ghost"
              className="danger-text mr-auto"
              onClick={() => {
                void confirm({
                  title: 'Usunąć zadanie?',
                  message: 'Zadanie, jego podzadania i powiązane bloki w planie zostaną usunięte.',
                  confirm: 'Usuń',
                  danger: true,
                }).then((ok) => {
                  if (ok)
                    void call(`/tasks/${existing.id}`, 'DELETE').then(onClose, () => undefined);
                });
              }}
            >
              <Trash2 size={15} />
              Usuń
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button variant="primary" type="submit" form="task-form" disabled={saving}>
            Zapisz zadanie
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={save} className="form-stack">
        <Field label="Co chcesz zrobić?">
          <input
            name="title"
            data-autofocus
            required
            maxLength={240}
            placeholder="Np. kolokwium z percepcji wizyjnej"
            defaultValue={existing?.title ?? draft?.title}
          />
        </Field>
        <div className="field">
          <span className="field-label">Rodzaj</span>
          <Segmented
            label="Rodzaj zadania"
            value={kind}
            onChange={setKind}
            options={(Object.keys(KIND_LABEL) as TaskKind[]).map((value) => ({
              value,
              label: KIND_LABEL[value],
            }))}
          />
        </div>
        <div className="form-grid">
          <Field label="Przedmiot">
            <select
              name="subject_id"
              defaultValue={existing?.subject_id ?? draft?.subject_id ?? ''}
            >
              <option value="">Ogólne</option>
              {data.subjects.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Termin" hint={due ? countdown(due) : undefined}>
            <input type="date" name="due_date" defaultValue={due ?? ''} />
          </Field>
          <Field label="Priorytet">
            <select
              name="priority"
              defaultValue={existing?.priority ?? draft?.priority ?? 'medium'}
            >
              {(['low', 'medium', 'high'] as const).map((p) => (
                <option value={p} key={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Notatki">
          <textarea
            name="notes"
            rows={3}
            maxLength={5000}
            placeholder="Zakres materiału, linki, kolejne kroki…"
            defaultValue={metadata ? metadata.user_notes : (existing?.notes ?? '')}
          />
        </Field>
        {metadata?.sources.length ? (
          <div className="sources">
            {metadata.sources.map((source, index) => (
              <blockquote key={index}>
                <span>Źródło · strona {source.page}</span>„{source.quote}”
              </blockquote>
            ))}
            {metadata.warning && <p className="warning-text">{metadata.warning}</p>}
            {existing?.document_id && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  onClose();
                  go({ page: 'doc', id: existing.document_id! });
                }}
              >
                <FileText size={14} /> Otwórz dokument źródłowy
              </button>
            )}
          </div>
        ) : null}
      </form>
      {existing && (
        <div className="subtasks">
          <h3>Podzadania</h3>
          {subtasks.map((sub) => (
            <div key={sub.id} className={cn('subtask', sub.status === 'done' && 'is-done')}>
              <button
                type="button"
                className="check check-sm"
                aria-label="Zmień status podzadania"
                onClick={() => {
                  const status = sub.status === 'done' ? 'todo' : 'done';
                  setSubtasks((all) => all.map((s) => (s.id === sub.id ? { ...s, status } : s)));
                  void call(`/tasks/${existing.id}/subtasks/${sub.id}`, 'PATCH', { status }).catch(
                    reload,
                  );
                }}
              >
                {sub.status === 'done' && <Check size={10} strokeWidth={3} />}
              </button>
              <span>{sub.title}</span>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                aria-label="Usuń podzadanie"
                onClick={() => {
                  setSubtasks((all) => all.filter((s) => s.id !== sub.id));
                  void call(`/tasks/${existing.id}/subtasks/${sub.id}`, 'DELETE').catch(reload);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <form
            className="subtask-add"
            onSubmit={(event) => {
              event.preventDefault();
              const title = newSubtask.trim();
              if (!title) return;
              setNewSubtask('');
              void call(`/tasks/${existing.id}/subtasks`, 'POST', {
                title,
                position: subtasks.length,
              }).then(reload, () => undefined);
            }}
          >
            <Plus size={14} />
            <input
              aria-label="Nowe podzadanie"
              placeholder="Dodaj krok i naciśnij Enter"
              value={newSubtask}
              maxLength={240}
              onChange={(event) => setNewSubtask(event.target.value)}
            />
          </form>
        </div>
      )}
    </Modal>
  );
}

/** Groups open tasks into time buckets relative to today. */
export function bucketTasks(tasks: Task[], today = todayKey()) {
  const buckets: { id: string; label: string; items: Task[] }[] = [
    { id: 'overdue', label: 'Zaległe', items: [] },
    { id: 'today', label: 'Dziś', items: [] },
    { id: 'tomorrow', label: 'Jutro', items: [] },
    { id: 'week', label: 'Najbliższe 7 dni', items: [] },
    { id: 'later', label: 'Później', items: [] },
    { id: 'none', label: 'Bez terminu', items: [] },
  ];
  const at = (id: string) => buckets.find((bucket) => bucket.id === id)!.items;
  for (const task of [...tasks].sort(
    (a, b) =>
      (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') ||
      (b.priority === 'high' ? 1 : 0) - (a.priority === 'high' ? 1 : 0),
  )) {
    if (!task.due_date) at('none').push(task);
    else {
      const diff = daysBetween(today, task.due_date);
      at(
        diff < 0
          ? 'overdue'
          : diff === 0
            ? 'today'
            : diff === 1
              ? 'tomorrow'
              : diff <= 7
                ? 'week'
                : 'later',
      ).push(task);
    }
  }
  return buckets.filter((bucket) => bucket.items.length);
}
