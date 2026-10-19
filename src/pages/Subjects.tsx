import { ArrowLeft, BookOpen, Check, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ScheduleEditor } from '../components/plan';
import { QuickAdd, TaskRow } from '../components/tasks';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Modal,
  PageHeader,
  SubjectDot,
  useFeedback,
} from '../components/ui';
import { isDone, nextClass } from '../lib/schedule';
import { useStore } from '../lib/store';
import { clock, daysBetween, fmt, plural, todayKey, WEEKDAYS } from '../lib/time';
import type { Bootstrap, Schedule, Subject } from '../lib/types';
import { DocumentList } from './Materials';

export const COLORS = [
  '#9b8cff',
  '#5cc8b0',
  '#f2a65a',
  '#6aa8ff',
  '#ef7d9a',
  '#b4c95c',
  '#e7c24f',
  '#c38cf2',
  '#59c3e6',
  '#f08b6b',
];

function nextFor(data: Bootstrap, subjectId: string) {
  return nextClass(
    { ...data, schedules: data.schedules.filter((s) => s.subject_id === subjectId) },
    new Date(),
    120,
  );
}

export function SubjectEditor({
  subject,
  onClose,
}: {
  subject: Subject | 'new';
  onClose: () => void;
}) {
  const { data, call, go } = useStore();
  const existing = subject === 'new' ? null : subject;
  const [color, setColor] = useState(
    existing?.color ?? COLORS[data.subjects.length % COLORS.length]!,
  );
  const [saving, setSaving] = useState(false);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const saved = await call<Subject>(
        existing ? `/subjects/${existing.id}` : '/subjects',
        existing ? 'PATCH' : 'POST',
        {
          name: form.get('name'),
          teacher: form.get('teacher') || '',
          color,
          ...(existing ? {} : { class_type: '' }),
        },
      );
      onClose();
      if (!existing) go({ page: 'subject', id: saved.id });
    } catch {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={existing ? 'Edytuj przedmiot' : 'Nowy przedmiot'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button variant="primary" type="submit" form="subject-form" disabled={saving}>
            Zapisz przedmiot
          </Button>
        </>
      }
    >
      <form id="subject-form" className="form-stack" onSubmit={save}>
        <Field label="Nazwa przedmiotu">
          <input
            name="name"
            required
            maxLength={240}
            data-autofocus
            defaultValue={existing?.name}
            placeholder="Np. Percepcja wizyjna w robotyce"
          />
        </Field>
        <Field label="Prowadzący">
          <input
            name="teacher"
            maxLength={160}
            defaultValue={existing?.teacher}
            placeholder="Opcjonalnie"
          />
        </Field>
        <div className="field">
          <span className="field-label">Kolor</span>
          <div className="color-picker">
            {COLORS.map((value) => (
              <button
                type="button"
                key={value}
                aria-label={`Kolor ${value}`}
                aria-pressed={color === value}
                style={{ background: value }}
                onClick={() => setColor(value)}
              >
                {color === value && <Check size={14} strokeWidth={3} />}
              </button>
            ))}
            <input
              aria-label="Własny kolor"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function Subjects() {
  const { data, go } = useStore();
  const [editor, setEditor] = useState<Subject | 'new' | null>(null);
  return (
    <div className="page">
      <PageHeader
        title="Przedmioty"
        subtitle={`${data.subjects.length} w semestrze`}
        actions={
          <Button variant="primary" onClick={() => setEditor('new')}>
            <Plus size={15} /> Nowy przedmiot
          </Button>
        }
      />
      {data.subjects.length ? (
        <div className="subject-grid">
          {data.subjects
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, 'pl'))
            .map((subject) => {
              const open = data.tasks.filter(
                (t) => t.subject_id === subject.id && !isDone(t),
              ).length;
              const docs = data.documents.filter((d) => d.subject_id === subject.id).length;
              const next = nextFor(data, subject.id);
              const types = [
                ...new Set(
                  data.schedules
                    .filter((s) => s.subject_id === subject.id)
                    .map((s) => s.class_type)
                    .filter(Boolean),
                ),
              ];
              return (
                <button
                  key={subject.id}
                  className="subject-card"
                  style={{ ['--c' as string]: subject.color }}
                  onClick={() => go({ page: 'subject', id: subject.id })}
                >
                  <span className="subject-card-bar" />
                  <h2>{subject.name}</h2>
                  <p className="muted small">
                    {[subject.teacher, types.join(', ')].filter(Boolean).join(' · ') || ' '}
                  </p>
                  <p className="subject-next">
                    {next
                      ? `${next.date === todayKey() ? 'Dziś' : fmt.weekdayShort(next.date)}${daysBetween(todayKey(), next.date) > 6 ? ` ${fmt.dayMonth(next.date)}` : ''} ${clock(next.start_at)}${next.location ? ` · ${next.location}` : ''}`
                      : 'Brak zajęć w planie'}
                  </p>
                  <span className="subject-stats">
                    <span>
                      {open} {plural(open, 'zadanie', 'zadania', 'zadań')}
                    </span>
                    <span>
                      {docs} {plural(docs, 'materiał', 'materiały', 'materiałów')}
                    </span>
                  </span>
                </button>
              );
            })}
        </div>
      ) : (
        <Card>
          <Empty
            icon={BookOpen}
            title="Dodaj swoje przedmioty"
            action={
              <Button onClick={() => setEditor('new')}>
                <Plus size={15} /> Nowy przedmiot
              </Button>
            }
          >
            Przedmiot łączy zajęcia z planu, zadania i materiały.
          </Empty>
        </Card>
      )}
      {editor && <SubjectEditor subject={editor} onClose={() => setEditor(null)} />}
    </div>
  );
}

export function SubjectPage({ id }: { id: string }) {
  const { data, go, call } = useStore();
  const { confirm } = useFeedback();
  const [editing, setEditing] = useState(false);
  const [schedule, setSchedule] = useState<Schedule | 'new' | null>(null);
  const [showDone, setShowDone] = useState(false);
  const subject = data.subjects.find((item) => item.id === id);
  if (!subject)
    return (
      <div className="page">
        <Card>
          <Empty icon={BookOpen} title="Nie znaleziono przedmiotu" />
        </Card>
      </div>
    );
  const schedules = data.schedules
    .filter((s) => s.subject_id === subject.id)
    .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
  const tasks = data.tasks.filter((t) => t.subject_id === subject.id);
  const open = tasks
    .filter((t) => !isDone(t))
    .sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9'));
  const done = tasks.filter(isDone);
  const documents = data.documents.filter((d) => d.subject_id === subject.id);
  const next = nextFor(data, subject.id);
  return (
    <div className="page">
      <button className="back-link" onClick={() => go({ page: 'subjects' })}>
        <ArrowLeft size={15} /> Przedmioty
      </button>
      <header className="subject-header" style={{ ['--c' as string]: subject.color }}>
        <SubjectDot color={subject.color} size={14} />
        <div className="grow">
          <h1>{subject.name}</h1>
          <p className="muted">
            {[
              subject.teacher,
              next &&
                `Następne: ${fmt.weekdayLong(next.date)} ${clock(next.start_at)}${next.location ? `, ${next.location}` : ''}`,
            ]
              .filter(Boolean)
              .join(' · ') || 'Brak zajęć w planie'}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Edytuj przedmiot"
          onClick={() => setEditing(true)}
        >
          <Pencil size={16} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Usuń przedmiot"
          onClick={() =>
            void confirm({
              title: `Usunąć „${subject.name}”?`,
              message:
                'Zajęcia tego przedmiotu znikną z planu. Zadania i materiały zostaną, ale bez przypisania.',
              confirm: 'Usuń',
              danger: true,
            }).then(
              (ok) =>
                ok &&
                void call(`/subjects/${subject.id}`, 'DELETE').then(
                  () => go({ page: 'subjects' }),
                  () => undefined,
                ),
            )
          }
        >
          <Trash2 size={16} />
        </Button>
      </header>
      <div className="subject-layout">
        <div className="stack">
          <Card
            title={
              <>
                Zadania <span className="count">{open.length}</span>
              </>
            }
          >
            <QuickAdd
              draft={{ subject_id: subject.id }}
              placeholder={`Dodaj zadanie z: ${subject.name}`}
            />
            {open.map((task) => (
              <TaskRow key={task.id} task={task} showSubject={false} />
            ))}
            {!open.length && <p className="muted small pad">Brak otwartych zadań.</p>}
            {done.length > 0 && (
              <button className="link-btn" onClick={() => setShowDone(!showDone)}>
                {showDone ? 'Ukryj' : 'Pokaż'} ukończone ({done.length})
              </button>
            )}
            {showDone &&
              done.map((task) => <TaskRow key={task.id} task={task} showSubject={false} />)}
          </Card>
          <div className="section-head">
            <h2>
              Materiały <span className="count">{documents.length}</span>
            </h2>
            <Button size="sm" onClick={() => go({ page: 'materials', id: subject.id })}>
              <Upload size={14} /> Dodaj
            </Button>
          </div>
          {documents.length ? (
            <DocumentList documents={documents} />
          ) : (
            <Card>
              <p className="muted small">Brak materiałów. Wgraj wykład, aby dostać notatki.</p>
            </Card>
          )}
        </div>
        <Card
          title="Zajęcia"
          action={
            <Button size="sm" onClick={() => setSchedule('new')}>
              <Plus size={14} /> Dodaj
            </Button>
          }
        >
          {schedules.length ? (
            schedules.map((item) => (
              <button key={item.id} className="schedule-entry" onClick={() => setSchedule(item)}>
                <span className="occ-time">
                  {WEEKDAYS[item.weekday - 1]!.slice(0, 3)}
                  <small>
                    {item.start_time}–{item.end_time}
                  </small>
                </span>
                <span className="grow">
                  <strong>{item.class_type || 'Zajęcia'}</strong>
                  <span>{item.location}</span>
                  {item.notes && <span className="muted small">{item.notes}</span>}
                </span>
                {Boolean(item.tentative) && <Badge tone="amber">do ustalenia</Badge>}
              </button>
            ))
          ) : (
            <p className="muted small">Brak zajęć cyklicznych.</p>
          )}
        </Card>
      </div>
      {editing && <SubjectEditor subject={subject} onClose={() => setEditing(false)} />}
      {schedule && (
        <ScheduleEditor
          schedule={schedule}
          defaults={{ subject_id: subject.id }}
          onClose={() => setSchedule(null)}
        />
      )}
    </div>
  );
}
