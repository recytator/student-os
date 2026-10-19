import {
  ArrowDownToLine,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { EventEditor, OccurrenceRow, ScheduleEditor, TimeGrid } from '../components/plan';
import { KIND_LABEL, KIND_TONE } from '../components/tasks';
import {
  Badge,
  Button,
  Card,
  Empty,
  PageHeader,
  Segmented,
  SubjectDot,
  useFeedback,
} from '../components/ui';
import { cn } from '../lib/cn';
import { dayDeadlines, dayItems, semesterWeek } from '../lib/schedule';
import { useStore } from '../lib/store';
import {
  addDays,
  fmt,
  minutesOfDay,
  mondayOf,
  todayKey,
  WEEKDAYS,
  WEEKDAYS_SHORT,
} from '../lib/time';
import type { Schedule } from '../lib/types';

type View = 'week' | 'day' | 'list';
const narrow = () => window.matchMedia('(max-width: 760px)').matches;

export function Plan() {
  const { data, editTask } = useStore();
  const [view, setView] = useState<View>(() => (narrow() ? 'day' : 'week'));
  const [date, setDate] = useState(todayKey);
  const [scheduleEditor, setScheduleEditor] = useState<Schedule | 'new' | null>(null);
  const [eventEditor, setEventEditor] = useState<{ date: string; start?: string } | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = todayKey();
  const monday = mondayOf(date);
  const week = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const weekend = week
    .slice(5)
    .some((day) => dayItems(data, day).length || dayDeadlines(data, day).tasks.length);
  const days = view === 'week' ? (weekend ? week : week.slice(0, 5)) : [date];
  const semester = semesterWeek(data, date);
  const step = (direction: number) => setDate(addDays(date, direction * (view === 'day' ? 1 : 7)));
  const allDay = (day: string) => {
    const { tasks, events } = dayDeadlines(data, day);
    return [
      ...tasks.map((task) => ({
        id: task.id,
        label: `${task.kind === 'task' ? '' : `${KIND_LABEL[task.kind]}: `}${task.title}`,
        tone: KIND_TONE[task.kind],
        onClick: () => editTask(task),
      })),
      ...events.map((event) => ({
        id: event.id,
        label: event.title,
        tone: 'neutral' as const,
        onClick: () => setEventEditor({ date: day }),
      })),
    ];
  };
  const rangeLabel =
    view === 'day'
      ? fmt.long(date)
      : `${fmt.dayMonth(days[0]!)} – ${fmt.dayMonth(days.at(-1)!)} ${days.at(-1)!.slice(0, 4)}`;
  return (
    <div className="page">
      <PageHeader
        title="Plan"
        subtitle={semester ? `${semester}. tydzień semestru` : 'Zajęcia, wydarzenia i terminy'}
        actions={
          <>
            <a
              className="btn btn-ghost btn-icon"
              href="/api/export.ics"
              download
              title="Eksport do Kalendarza Google / Outlook (ICS)"
              aria-label="Eksportuj ICS"
            >
              <ArrowDownToLine size={16} />
            </a>
            <Button onClick={() => setEventEditor({ date })}>
              <Plus size={15} /> Wydarzenie
            </Button>
            <Button variant="primary" onClick={() => setScheduleEditor('new')}>
              <Plus size={15} /> Zajęcia
            </Button>
          </>
        }
      />
      <div className="plan-toolbar">
        {view !== 'list' && (
          <div className="date-nav">
            <button className="icon-btn" aria-label="Poprzedni okres" onClick={() => step(-1)}>
              <ChevronLeft size={18} />
            </button>
            <button className="icon-btn" aria-label="Następny okres" onClick={() => step(1)}>
              <ChevronRight size={18} />
            </button>
            <h2>{rangeLabel}</h2>
            {(view === 'day' ? date !== today : monday !== mondayOf(today)) && (
              <Button size="sm" onClick={() => setDate(today)}>
                Dziś
              </Button>
            )}
          </div>
        )}
        <Segmented
          label="Widok planu"
          value={view}
          onChange={setView}
          options={[
            { value: 'week', label: 'Tydzień' },
            { value: 'day', label: 'Dzień' },
            { value: 'list', label: 'Zajęcia' },
          ]}
        />
      </div>
      {view === 'day' && (
        <div className="day-strip" role="tablist" aria-label="Dni tygodnia">
          {week.map((day, index) => {
            const count = dayItems(data, day).filter((item) => item.status !== 'cancelled').length;
            return (
              <button
                key={day}
                role="tab"
                aria-selected={day === date}
                className={cn(day === date && 'active', day === today && 'is-today')}
                onClick={() => setDate(day)}
              >
                <span>{WEEKDAYS_SHORT[index]}</span>
                <strong>{Number(day.slice(8))}</strong>
                <i>{count ? '•'.repeat(Math.min(count, 4)) : ''}</i>
              </button>
            );
          })}
        </div>
      )}
      {view === 'week' && (
        <TimeGrid
          days={days}
          itemsFor={(day) => dayItems(data, day)}
          allDayFor={allDay}
          today={today}
          nowMinute={minutesOfDay(now.toISOString())}
          onSlot={(day, start) => setEventEditor({ date: day, start })}
        />
      )}
      {view === 'day' && <DayAgenda date={date} onAdd={() => setEventEditor({ date })} />}
      {view === 'list' && <ScheduleList onEdit={setScheduleEditor} />}
      {view === 'week' && (
        <p className="plan-legend">
          <span className="legend-item">
            <i className="legend-tentative" /> tygodnie do ustalenia — kliknij, aby potwierdzić lub
            odwołać
          </span>
          <span className="legend-item">Dwuklik w pustym miejscu dodaje wydarzenie</span>
        </p>
      )}
      {scheduleEditor && (
        <ScheduleEditor schedule={scheduleEditor} onClose={() => setScheduleEditor(null)} />
      )}
      {eventEditor && (
        <EventEditor
          event="new"
          date={eventEditor.date}
          start={eventEditor.start}
          onClose={() => setEventEditor(null)}
        />
      )}
    </div>
  );
}

function DayAgenda({ date, onAdd }: { date: string; onAdd: () => void }) {
  const { data, editTask } = useStore();
  const items = dayItems(data, date);
  const { tasks } = dayDeadlines(data, date);
  const now = minutesOfDay(new Date().toISOString());
  const today = todayKey();
  return (
    <Card>
      {tasks.length > 0 && (
        <div className="allday-list">
          {tasks.map((task) => (
            <button key={task.id} className="allday-item" onClick={() => editTask(task)}>
              <Badge tone={KIND_TONE[task.kind]}>
                {task.kind === 'task' ? 'Termin' : KIND_LABEL[task.kind]}
              </Badge>
              <span>{task.title}</span>
            </button>
          ))}
        </div>
      )}
      {items.length ? (
        <div className="timeline">
          {items.map((item) => (
            <OccurrenceRow
              key={item.id}
              item={item}
              past={date < today || (date === today && item.end <= now)}
              live={date === today && item.start <= now && item.end > now}
            />
          ))}
        </div>
      ) : (
        <Empty
          icon={CalendarDays}
          title="Brak zajęć"
          compact
          action={
            <Button size="sm" onClick={onAdd}>
              <Plus size={14} /> Dodaj wydarzenie
            </Button>
          }
        />
      )}
    </Card>
  );
}

function ScheduleList({ onEdit }: { onEdit: (schedule: Schedule) => void }) {
  const { data, subject, call } = useStore();
  const { confirm, toast } = useFeedback();
  const ends = [...new Set(data.schedules.map((s) => s.valid_to))].sort();
  const end = ends.at(-1);
  const [newEnd, setNewEnd] = useState(end ?? '');
  const venues = data.timetables.flatMap((timetable) => timetable.venues);
  const applyEnd = async () => {
    if (!end || !newEnd || newEnd === end) return;
    const affected = data.schedules.filter((s) => s.valid_to === end && s.valid_from <= newEnd);
    const ok = await confirm({
      title: 'Zmienić koniec semestru?',
      message: `${affected.length} serii zajęć kończących się ${fmt.numeric(end)} będzie obowiązywać do ${fmt.numeric(newEnd)}.`,
      confirm: 'Zmień',
    });
    if (!ok) return;
    for (const schedule of affected)
      await call(`/schedules/${schedule.id}`, 'PATCH', { valid_to: newEnd }, { quiet: true }).catch(
        () => undefined,
      );
    toast('Zaktualizowano koniec semestru.');
  };
  if (!data.schedules.length)
    return (
      <Card>
        <Empty icon={CalendarDays} title="Brak zajęć w planie">
          Dodaj zajęcia cykliczne przyciskiem „Zajęcia”. Pojawią się w każdym tygodniu między datami
          obowiązywania.
        </Empty>
      </Card>
    );
  return (
    <div className="stack">
      {end && (
        <Card>
          <div className="semester-end">
            <div>
              <strong>Koniec zajęć w semestrze</strong>
              <p className="muted small">
                Zmienia datę końcową wszystkich serii kończących się {fmt.numeric(end)}.
              </p>
            </div>
            <input
              type="date"
              aria-label="Koniec semestru"
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
            />
            <Button disabled={!newEnd || newEnd === end} onClick={() => void applyEnd()}>
              Zastosuj
            </Button>
          </div>
        </Card>
      )}
      <div className="schedule-days">
        {WEEKDAYS.map((day, index) => {
          const entries = data.schedules
            .filter((s) => s.weekday === index + 1)
            .sort((a, b) => a.start_time.localeCompare(b.start_time));
          if (!entries.length) return null;
          return (
            <Card key={day} title={day} className="schedule-day">
              {entries.map((schedule) => {
                const item = subject(schedule.subject_id);
                return (
                  <button
                    key={schedule.id}
                    className="schedule-entry"
                    onClick={() => onEdit(schedule)}
                  >
                    <span className="occ-time">
                      {schedule.start_time}
                      <small>{schedule.end_time}</small>
                    </span>
                    <SubjectDot color={item?.color} />
                    <span className="grow">
                      <strong>{item?.name ?? 'Zajęcia'}</strong>
                      <span>
                        {[schedule.class_type, schedule.location].filter(Boolean).join(' · ')}
                        {schedule.notes && <em> · {schedule.notes}</em>}
                      </span>
                      <span className="muted small">
                        {fmt.numeric(schedule.valid_from)} – {fmt.numeric(schedule.valid_to)}
                      </span>
                    </span>
                    {Boolean(schedule.tentative) && <Badge tone="amber">do ustalenia</Badge>}
                    <Pencil size={14} className="muted" />
                  </button>
                );
              })}
            </Card>
          );
        })}
      </div>
      {venues.length > 0 && (
        <Card title="Budynki">
          <ul className="plain-list">
            {venues.map((venue) => (
              <li key={venue}>{venue}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
