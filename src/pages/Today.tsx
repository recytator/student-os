import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  MapPin,
  NotebookText,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { bucketTasks, KIND_LABEL, KIND_TONE, QuickAdd, TaskRow } from '../components/tasks';
import { Badge, Button, Card, Empty, SubjectDot } from '../components/ui';
import { OccurrenceRow } from '../components/plan';
import { dayDeadlines, dayItems, isDone, nextClass, semesterWeek } from '../lib/schedule';
import { useStore } from '../lib/store';
import {
  addDays,
  clock,
  countdown,
  dayKey,
  duration,
  fmt,
  minutesOfDay,
  plural,
  todayKey,
} from '../lib/time';

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function Today() {
  const { data, subject, go } = useStore();
  const now = useNow();
  const today = todayKey();
  const minute = minutesOfDay(now.toISOString());
  const items = dayItems(data, today);
  const deadlines = dayDeadlines(data, today);
  const week = semesterWeek(data, today);
  const classes = items.filter((item) => item.type === 'class' && item.status !== 'cancelled');
  const current = classes.find((item) => item.start <= minute && item.end > minute);
  const next = nextClass(data, now);
  const open = data.tasks.filter((task) => !isDone(task));
  const buckets = bucketTasks(open, today).filter((bucket) =>
    ['overdue', 'today', 'tomorrow', 'week'].includes(bucket.id),
  );
  const upcomingTasks = buckets.flatMap((bucket) => bucket.items);
  const exams = open
    .filter((task) => task.kind !== 'task' && task.due_date && task.due_date >= today)
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
    .slice(0, 5);
  const tomorrow = dayItems(data, addDays(today, 1)).filter(
    (item) => item.type === 'class' && item.status !== 'cancelled',
  );
  const recentNotes = data.notes.filter((note) => note.state === 'ready').slice(0, 4);
  const firstName = data.user.name?.split(' ')[0];
  const doneToday = data.tasks.filter(
    (task) => isDone(task) && dayKey(new Date(task.updated_at)) === today,
  ).length;

  const hero = current ?? (next && next.date === today ? next : null);
  return (
    <div className="page today">
      <div className="today-header">
        <div>
          <p className="eyebrow">
            {fmt.long(today)}
            {week ? ` · ${week}. tydzień semestru` : ''}
          </p>
          <h1>{firstName ? `Cześć, ${firstName}` : 'Dzień dobry'}</h1>
        </div>
        <div className="today-stats">
          <span>
            <strong>{classes.length}</strong>{' '}
            {plural(classes.length, 'zajęcia', 'zajęcia', 'zajęć')} dziś
          </span>
          <span>
            <strong>{upcomingTasks.length}</strong>{' '}
            {plural(upcomingTasks.length, 'zadanie', 'zadania', 'zadań')} na 7 dni
          </span>
          {doneToday > 0 && (
            <span>
              <strong>{doneToday}</strong> ukończone dziś
            </span>
          )}
        </div>
      </div>

      <section className={`now-card ${current ? 'is-live' : ''}`}>
        {hero ? (
          <>
            <div className="now-label">
              {current ? (
                <>
                  <span className="live-dot" /> Teraz · zostało {duration(current.end - minute)}
                </>
              ) : (
                <>
                  Następne ·{' '}
                  {hero.start - minute > 0 ? `za ${duration(hero.start - minute)}` : 'zaraz'}
                </>
              )}
            </div>
            <div className="now-main">
              <SubjectDot color={subject(hero.subject_id)?.color} size={10} />
              <div>
                <h2>{hero.title}</h2>
                <p>
                  {clock(hero.start_at)}–{clock(hero.end_at)}
                  {hero.class_type && ` · ${hero.class_type}`}
                  {hero.location && (
                    <>
                      {' · '}
                      <MapPin size={13} /> {hero.location}
                    </>
                  )}
                  {hero.tentative && <Badge tone="amber">tydzień niepotwierdzony</Badge>}
                </p>
              </div>
            </div>
            {current && (
              <div className="now-progress" aria-hidden>
                <span
                  style={{
                    width: `${((minute - current.start) / (current.end - current.start)) * 100}%`,
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <div className="now-main">
            <CheckCircle2 size={20} className="muted" />
            <div>
              <h2>{classes.length ? 'Na dziś koniec zajęć' : 'Dziś bez zajęć'}</h2>
              <p>
                {next
                  ? `Następne: ${next.title} · ${fmt.weekdayLong(next.date)} ${clock(next.start_at)}${next.location ? ` · ${next.location}` : ''}`
                  : 'Dodaj plan zajęć, aby widzieć tu kolejne zajęcia.'}
              </p>
            </div>
          </div>
        )}
      </section>

      <div className="today-grid">
        <Card
          title="Plan dnia"
          action={
            <button className="link-btn" onClick={() => go({ page: 'plan' })}>
              Tydzień <ArrowRight size={14} />
            </button>
          }
        >
          {deadlines.tasks.length > 0 && (
            <div className="allday-list">
              {deadlines.tasks.map((task) => (
                <div className="allday-item" key={task.id}>
                  <Badge tone={KIND_TONE[task.kind]}>
                    {task.kind === 'task' ? 'Termin' : KIND_LABEL[task.kind]}
                  </Badge>
                  <span>{task.title}</span>
                </div>
              ))}
            </div>
          )}
          {items.length ? (
            <div className="timeline">
              {items.map((item) => (
                <OccurrenceRow
                  key={item.id}
                  item={item}
                  past={item.end <= minute}
                  live={item.start <= minute && item.end > minute}
                />
              ))}
            </div>
          ) : (
            <Empty icon={CalendarDays} title="Wolny dzień" compact>
              {tomorrow.length
                ? `Jutro ${tomorrow.length} ${plural(tomorrow.length, 'zajęcia', 'zajęcia', 'zajęć')}, pierwsze o ${clock(tomorrow[0]!.start_at)}.`
                : 'Brak zajęć i wydarzeń.'}
            </Empty>
          )}
          {items.length > 0 && tomorrow.length > 0 && (
            <p className="card-foot">
              Jutro: {tomorrow.length} {plural(tomorrow.length, 'zajęcia', 'zajęcia', 'zajęć')},
              start {clock(tomorrow[0]!.start_at)} · {tomorrow[0]!.title}
            </p>
          )}
        </Card>

        <div className="stack">
          <Card
            title="Do zrobienia"
            action={
              <button className="link-btn" onClick={() => go({ page: 'tasks' })}>
                Wszystkie <ArrowRight size={14} />
              </button>
            }
          >
            <QuickAdd />
            {buckets.length ? (
              buckets.map((bucket) => (
                <div className="task-group" key={bucket.id}>
                  <h3 className={bucket.id === 'overdue' ? 'danger-text' : ''}>
                    {bucket.label} <span>{bucket.items.length}</span>
                  </h3>
                  {bucket.items.slice(0, 6).map((task) => (
                    <TaskRow key={task.id} task={task} />
                  ))}
                </div>
              ))
            ) : (
              <Empty icon={CheckCircle2} title="Nic pilnego na ten tydzień" compact>
                {open.length
                  ? `${open.length} ${plural(open.length, 'zadanie czeka', 'zadania czekają', 'zadań czeka')} później lub bez terminu.`
                  : 'Dodaj zadanie powyżej.'}
              </Empty>
            )}
          </Card>

          {exams.length > 0 && (
            <Card title="Egzaminy i kolokwia">
              <ul className="countdown-list">
                {exams.map((task) => (
                  <li key={task.id}>
                    <Badge tone={KIND_TONE[task.kind]}>{KIND_LABEL[task.kind]}</Badge>
                    <span className="grow">
                      {task.title}
                      {subject(task.subject_id) && <small>{subject(task.subject_id)!.name}</small>}
                    </span>
                    <strong>{countdown(task.due_date!)}</strong>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card
            title="Notatki"
            action={
              <button className="link-btn" onClick={() => go({ page: 'materials' })}>
                Materiały <ArrowRight size={14} />
              </button>
            }
          >
            {recentNotes.length ? (
              <ul className="link-list">
                {recentNotes.map((note) => {
                  const document = data.documents.find((d) => d.id === note.document_id);
                  return (
                    <li key={note.id}>
                      <button onClick={() => go({ page: 'doc', id: note.document_id })}>
                        <NotebookText size={16} />
                        <span className="grow">
                          {note.title || document?.name}
                          <small>{document?.name}</small>
                        </span>
                        <ArrowRight size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty
                icon={Sparkles}
                title="Notatki z wykładów"
                compact
                action={
                  <Button size="sm" onClick={() => go({ page: 'materials' })}>
                    <Upload size={14} /> Dodaj PDF lub PPTX
                  </Button>
                }
              >
                Wgraj prezentację, a AI przygotuje notatki i fiszki.
              </Empty>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
