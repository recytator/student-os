import {
  AlertTriangle,
  CalendarCheck,
  CalendarX,
  Clock,
  MapPin,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { cn } from '../lib/cn';
import { layoutColumns, occurrenceConflicts, type Occurrence } from '../lib/schedule';
import { useStore } from '../lib/store';
import { clock, fmt, WEEKDAYS, warsawInstant, dayKey } from '../lib/time';
import type { CalendarEvent, Schedule } from '../lib/types';
import { Badge, Button, Field, Modal, SubjectDot, useFeedback } from './ui';

export function OccurrenceRow({
  item,
  past,
  live,
}: {
  item: Occurrence;
  past?: boolean;
  live?: boolean;
}) {
  const { subject } = useStore();
  const [open, setOpen] = useState(false);
  const color = subject(item.subject_id)?.color;
  return (
    <>
      <button
        type="button"
        className={cn(
          'occurrence',
          past && 'is-past',
          live && 'is-live',
          item.status === 'cancelled' && 'is-cancelled',
          item.tentative && 'is-tentative',
          item.type === 'block' && 'is-block',
        )}
        onClick={() => setOpen(true)}
      >
        <span className="occ-time">
          {clock(item.start_at)}
          <small>{clock(item.end_at)}</small>
        </span>
        <span className="occ-bar" style={{ background: color ?? 'var(--accent)' }} />
        <span className="occ-body">
          <strong>{item.title}</strong>
          <span>
            {[item.class_type, item.location].filter(Boolean).join(' · ') ||
              (item.type === 'block' ? 'Blok nauki' : 'Wydarzenie')}
          </span>
        </span>
        {item.status === 'cancelled' ? (
          <Badge>odwołane</Badge>
        ) : item.tentative ? (
          <Badge tone="amber">?</Badge>
        ) : live ? (
          <Badge tone="accent">teraz</Badge>
        ) : null}
      </button>
      {open && <OccurrenceDialog item={item} onClose={() => setOpen(false)} />}
    </>
  );
}

export function OccurrenceDialog({ item, onClose }: { item: Occurrence; onClose: () => void }) {
  const { call, subject } = useStore();
  const [editing, setEditing] = useState<'schedule' | 'event' | null>(null);
  if (editing === 'schedule' && item.schedule)
    return <ScheduleEditor schedule={item.schedule} onClose={onClose} />;
  if (editing === 'event' && item.event)
    return <EventEditor event={item.event} onClose={onClose} />;
  const setException = async (kind: 'cancelled' | 'confirmed' | null) => {
    const id = item.schedule!.id;
    try {
      if (kind) await call(`/schedules/${id}/exceptions`, 'POST', { date: item.date, kind });
      else await call(`/schedules/${id}/exceptions/${item.date}`, 'DELETE');
      onClose();
    } catch {
      /* Toast shown. */
    }
  };
  const subjectItem = subject(item.subject_id);
  return (
    <Modal title={item.title} size="sm" onClose={onClose}>
      <div className="occ-detail">
        <p>
          <Clock size={15} />
          {fmt.long(item.date)} · {clock(item.start_at)}–{clock(item.end_at)}
        </p>
        {item.location && (
          <p>
            <MapPin size={15} />
            {item.location}
          </p>
        )}
        {subjectItem && (
          <p>
            <SubjectDot color={subjectItem.color} size={10} />
            {subjectItem.name}
            {item.class_type && <Badge>{item.class_type}</Badge>}
          </p>
        )}
        {item.notes && <p className="muted">{item.notes}</p>}
        {item.schedule && (
          <p className="muted small">
            Co tydzień, {WEEKDAYS[item.schedule.weekday - 1]!.toLowerCase()} ·{' '}
            {fmt.numeric(item.schedule.valid_from)} – {fmt.numeric(item.schedule.valid_to)}
          </p>
        )}
        {item.tentative && item.status !== 'cancelled' && (
          <div className="notice notice-amber">
            <AlertTriangle size={15} />
            Plan nie określa, w które tygodnie odbywają się te zajęcia. Potwierdź albo odwołaj ten
            tydzień.
          </div>
        )}
      </div>
      {item.schedule ? (
        <div className="action-list">
          {item.status === 'cancelled' ? (
            <Button onClick={() => void setException(null)}>
              <CalendarCheck size={15} /> Przywróć zajęcia w tym dniu
            </Button>
          ) : (
            <>
              {item.tentative && (
                <Button variant="primary" onClick={() => void setException('confirmed')}>
                  <CalendarCheck size={15} /> Odbywają się w tym tygodniu
                </Button>
              )}
              {item.status === 'confirmed' && (
                <Button onClick={() => void setException(null)}>Cofnij potwierdzenie</Button>
              )}
              <Button onClick={() => void setException('cancelled')}>
                <CalendarX size={15} /> Nie ma w tym dniu
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => setEditing('schedule')}>
            <Pencil size={15} /> Edytuj całą serię
          </Button>
        </div>
      ) : (
        <div className="action-list">
          <Button onClick={() => setEditing('event')}>
            <Pencil size={15} /> Edytuj
          </Button>
        </div>
      )}
    </Modal>
  );
}

export function ScheduleEditor({
  schedule,
  defaults,
  onClose,
}: {
  schedule: Schedule | 'new';
  defaults?: Partial<Schedule>;
  onClose: () => void;
}) {
  const { data, call } = useStore();
  const { confirm } = useFeedback();
  const existing = schedule === 'new' ? null : schedule;
  const initial = { ...defaults, ...existing };
  const [saving, setSaving] = useState(false);
  const semesterEnd =
    data.schedules
      .map((s) => s.valid_to)
      .sort()
      .at(-1) ?? `${data.preferences.academic_year.slice(5)}-01-31`;
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await call(
        existing ? `/schedules/${existing.id}` : '/schedules',
        existing ? 'PATCH' : 'POST',
        {
          subject_id: form.get('subject_id'),
          weekday: Number(form.get('weekday')),
          start_time: form.get('start_time'),
          end_time: form.get('end_time'),
          valid_from: form.get('valid_from'),
          valid_to: form.get('valid_to'),
          location: form.get('location') || '',
          class_type: form.get('class_type') || '',
          notes: form.get('notes') || '',
          tentative: form.get('tentative') === 'on' ? 1 : 0,
        },
      );
      onClose();
    } catch {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={existing ? 'Edytuj zajęcia' : 'Nowe zajęcia cykliczne'}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <Button
              variant="ghost"
              className="danger-text mr-auto"
              onClick={() =>
                void confirm({
                  title: 'Usunąć całą serię zajęć?',
                  message: 'Zajęcia znikną z każdego tygodnia planu.',
                  confirm: 'Usuń serię',
                  danger: true,
                }).then(
                  (ok) =>
                    ok &&
                    void call(`/schedules/${existing.id}`, 'DELETE').then(onClose, () => undefined),
                )
              }
            >
              <Trash2 size={15} /> Usuń
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="schedule-form"
            disabled={saving || !data.subjects.length}
          >
            Zapisz zajęcia
          </Button>
        </>
      }
    >
      {!data.subjects.length ? (
        <p className="muted">Najpierw dodaj przedmiot w zakładce Przedmioty.</p>
      ) : (
        <form id="schedule-form" onSubmit={save} className="form-stack">
          <div className="form-grid">
            <Field label="Przedmiot" className="span-2">
              <select
                name="subject_id"
                required
                defaultValue={initial.subject_id ?? ''}
                data-autofocus
              >
                <option value="" disabled>
                  Wybierz przedmiot
                </option>
                {data.subjects.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Rodzaj zajęć">
              <input
                name="class_type"
                list="class-types"
                maxLength={40}
                placeholder="wykład, ćwiczenia, lab…"
                defaultValue={initial.class_type ?? ''}
              />
              <datalist id="class-types">
                {['wykład', 'ćwiczenia', 'laboratorium', 'projekt', 'seminarium', 'GI1', 'GL2'].map(
                  (type) => (
                    <option key={type} value={type} />
                  ),
                )}
              </datalist>
            </Field>
            <Field label="Dzień tygodnia">
              <select name="weekday" defaultValue={initial.weekday ?? 1}>
                {WEEKDAYS.map((day, index) => (
                  <option value={index + 1} key={day}>
                    {day}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Początek">
              <input
                name="start_time"
                type="time"
                required
                defaultValue={initial.start_time ?? '10:00'}
              />
            </Field>
            <Field label="Koniec">
              <input
                name="end_time"
                type="time"
                required
                defaultValue={initial.end_time ?? '11:30'}
              />
            </Field>
            <Field label="Obowiązuje od">
              <input
                name="valid_from"
                type="date"
                required
                defaultValue={initial.valid_from ?? dayKey(new Date())}
              />
            </Field>
            <Field label="Obowiązuje do">
              <input
                name="valid_to"
                type="date"
                required
                defaultValue={initial.valid_to ?? semesterEnd}
              />
            </Field>
            <Field label="Sala / miejsce" className="span-2">
              <input
                name="location"
                maxLength={200}
                defaultValue={initial.location ?? ''}
                placeholder="Np. s. B8, IBS"
              />
            </Field>
            <Field label="Uwagi" className="span-2">
              <input
                name="notes"
                maxLength={500}
                defaultValue={initial.notes ?? ''}
                placeholder="Np. co drugi tydzień, 5 spotkań"
              />
            </Field>
          </div>
          <label className="toggle">
            <input type="checkbox" name="tentative" defaultChecked={Boolean(initial.tentative)} />
            <span>
              <strong>Tygodnie do ustalenia</strong>
              <small>
                Zajęcia pojawią się w planie jako niepotwierdzone, dopóki nie potwierdzisz danego
                tygodnia.
              </small>
            </span>
          </label>
        </form>
      )}
    </Modal>
  );
}

export function EventEditor({
  event,
  date,
  start,
  onClose,
}: {
  event: CalendarEvent | 'new';
  date?: string;
  start?: string;
  onClose: () => void;
}) {
  const startDefault = start ?? '10:00';
  const [sh, sm] = startDefault.split(':').map(Number);
  const endMinutes = Math.min(sh! * 60 + sm! + 90, 23 * 60 + 59);
  const endDefault = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  const { data, call } = useStore();
  const { confirm } = useFeedback();
  const existing = event === 'new' ? null : event;
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const form = new FormData(submitEvent.currentTarget);
    const day = String(form.get('date'));
    const value = {
      title: String(form.get('title')),
      subject_id: form.get('subject_id') || null,
      start_at: warsawInstant(day, String(form.get('start'))),
      end_at: warsawInstant(day, String(form.get('end'))),
      location: form.get('location') || '',
      document_id: existing?.document_id ?? null,
    };
    if (new Date(value.end_at) <= new Date(value.start_at)) {
      setError('Koniec musi być później niż początek.');
      return;
    }
    setSaving(true);
    try {
      await call(
        existing ? `/events/${existing.id}` : '/events',
        existing ? 'PATCH' : 'POST',
        value,
      );
      onClose();
    } catch {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={existing ? 'Edytuj wydarzenie' : 'Nowe wydarzenie'}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <Button
              variant="ghost"
              className="danger-text mr-auto"
              onClick={() =>
                void confirm({ title: 'Usunąć wydarzenie?', confirm: 'Usuń', danger: true }).then(
                  (ok) =>
                    ok &&
                    void call(`/events/${existing.id}`, 'DELETE').then(onClose, () => undefined),
                )
              }
            >
              <Trash2 size={15} /> Usuń
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Anuluj
          </Button>
          <Button variant="primary" type="submit" form="event-form" disabled={saving}>
            Zapisz wydarzenie
          </Button>
        </>
      }
    >
      <form id="event-form" onSubmit={save} className="form-stack">
        <Field label="Nazwa">
          <input
            name="title"
            required
            maxLength={240}
            data-autofocus
            defaultValue={existing?.title ?? ''}
            placeholder="Np. konsultacje, spotkanie projektowe"
          />
        </Field>
        <div className="form-grid">
          <Field label="Data">
            <input
              name="date"
              type="date"
              required
              defaultValue={
                existing ? dayKey(new Date(existing.start_at)) : (date ?? dayKey(new Date()))
              }
            />
          </Field>
          <Field label="Przedmiot">
            <select name="subject_id" defaultValue={existing?.subject_id ?? ''}>
              <option value="">Ogólne</option>
              {data.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Od">
            <input
              name="start"
              type="time"
              required
              defaultValue={existing ? clock(existing.start_at) : startDefault}
            />
          </Field>
          <Field label="Do">
            <input
              name="end"
              type="time"
              required
              defaultValue={existing ? clock(existing.end_at) : endDefault}
            />
          </Field>
          <Field label="Miejsce" className="span-2">
            <input name="location" maxLength={200} defaultValue={existing?.location ?? ''} />
          </Field>
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>
    </Modal>
  );
}

const HOUR = 52;
/** Week or day time grid with overlap-aware columns. */
export function TimeGrid({
  days,
  itemsFor,
  allDayFor,
  onSlot,
  nowMinute,
  today,
}: {
  days: string[];
  itemsFor: (date: string) => Occurrence[];
  allDayFor: (date: string) => {
    id: string;
    label: string;
    tone: 'neutral' | 'red' | 'amber' | 'blue';
    onClick: () => void;
  }[];
  onSlot: (date: string, time: string) => void;
  nowMinute: number;
  today: string;
}) {
  const { subject } = useStore();
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const all = days.flatMap((date) => itemsFor(date));
  const startHour = Math.min(8, ...all.map((item) => Math.floor(item.start / 60)));
  const endHour = Math.max(18, ...all.map((item) => Math.ceil(item.end / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const hasAllDay = days.some((date) => allDayFor(date).length);
  return (
    <div className="time-grid" style={{ ['--days' as string]: days.length }}>
      <div className="tg-head">
        <span />
        {days.map((date) => (
          <div key={date} className={cn('tg-day-head', date === today && 'is-today')}>
            <span>{fmt.weekdayShort(date)}</span>
            <strong>{Number(date.slice(8))}</strong>
          </div>
        ))}
      </div>
      {hasAllDay && (
        <div className="tg-allday">
          <span className="tg-label">cały dzień</span>
          {days.map((date) => (
            <div key={date}>
              {allDayFor(date).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`tg-chip tone-${entry.tone}`}
                  onClick={entry.onClick}
                  title={entry.label}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="tg-body" style={{ height: hours.length * HOUR }}>
        <div className="tg-hours">
          {hours.map((hour) => (
            <span key={hour} style={{ top: (hour - startHour) * HOUR }}>
              {String(hour).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {days.map((date) => {
          const items = itemsFor(date);
          const conflicts = occurrenceConflicts(items);
          return (
            <div
              key={date}
              className={cn('tg-col', date === today && 'is-today')}
              onDoubleClick={(event) => {
                if (event.target !== event.currentTarget) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const minutes =
                  startHour * 60 + Math.floor(((event.clientY - rect.top) / HOUR) * 2) * 30;
                onSlot(
                  date,
                  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
                );
              }}
            >
              {hours.map((hour) => (
                <span key={hour} className="tg-line" style={{ top: (hour - startHour) * HOUR }} />
              ))}
              {date === today && nowMinute >= startHour * 60 && nowMinute <= endHour * 60 && (
                <span
                  className="tg-now"
                  style={{ top: ((nowMinute - startHour * 60) / 60) * HOUR }}
                />
              )}
              {layoutColumns(items).map(({ item, column, columns }) => {
                const color = subject(item.subject_id)?.color ?? 'var(--accent)';
                const height = Math.max(((item.end - item.start) / 60) * HOUR - 2, 18);
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={cn(
                      'tg-event',
                      item.status === 'cancelled' && 'is-cancelled',
                      item.tentative && 'is-tentative',
                      item.type === 'block' && 'is-block',
                      height < 40 && 'is-short',
                    )}
                    style={{
                      top: ((item.start - startHour * 60) / 60) * HOUR + 1,
                      height,
                      left: `calc(${(column / columns) * 100}% + 2px)`,
                      width: `calc(${100 / columns}% - 4px)`,
                      ['--c' as string]: color,
                    }}
                    onClick={() => setSelected(item)}
                    title={`${item.title} · ${clock(item.start_at)}–${clock(item.end_at)}${item.location ? ` · ${item.location}` : ''}`}
                  >
                    <strong>{item.title}</strong>
                    <span>
                      {clock(item.start_at)}–{clock(item.end_at)}
                      {item.class_type && ` · ${item.class_type}`}
                    </span>
                    {item.location && height >= 58 && <span>{item.location}</span>}
                    {item.tentative && item.status !== 'cancelled' && <i className="tg-flag">?</i>}
                    {conflicts.has(item.id) && <i className="tg-flag tg-conflict">!</i>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {selected && <OccurrenceDialog item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
