import type { Bootstrap, CalendarEvent, Schedule, Task } from './types';
import {
  addDays,
  daysBetween,
  minutesOfDay,
  mondayOf,
  todayKey,
  toMinutes,
  warsawInstant,
  weekday,
  dayKey,
} from './time';

export type Occurrence = {
  id: string;
  type: 'class' | 'event' | 'block';
  date: string;
  start: number;
  end: number;
  start_at: string;
  end_at: string;
  title: string;
  subject_id: string | null;
  location: string;
  class_type: string;
  notes: string;
  tentative: boolean;
  status: 'planned' | 'cancelled' | 'confirmed';
  schedule?: Schedule;
  event?: CalendarEvent;
};

export const isDone = (task: Task) => task.status === 'done';
const isAllDay = (event: CalendarEvent) =>
  minutesOfDay(event.start_at) === 0 &&
  minutesOfDay(event.end_at) === 0 &&
  new Date(event.end_at).getTime() - new Date(event.start_at).getTime() >= 86_400_000 - 3_600_000;
export const isBlock = (event: CalendarEvent) => (event.proposal_id ?? '').includes(':block-');

/** Timed items of one day: recurring classes (with week exceptions), events and study blocks. */
export function dayItems(data: Bootstrap, date: string): Occurrence[] {
  const items: Occurrence[] = [];
  const subjectName = (id: string | null) => data.subjects.find((s) => s.id === id)?.name;
  for (const schedule of data.schedules) {
    if (
      schedule.weekday !== weekday(date) ||
      date < schedule.valid_from ||
      date > schedule.valid_to
    )
      continue;
    const exception = data.schedule_exceptions.find(
      (item) => item.schedule_id === schedule.id && item.date === date,
    );
    items.push({
      id: `class:${schedule.id}:${date}`,
      type: 'class',
      date,
      start: toMinutes(schedule.start_time),
      end: toMinutes(schedule.end_time),
      start_at: warsawInstant(date, schedule.start_time),
      end_at: warsawInstant(date, schedule.end_time),
      title: subjectName(schedule.subject_id) ?? 'Zajęcia',
      subject_id: schedule.subject_id,
      location: schedule.location,
      class_type: schedule.class_type ?? '',
      notes: schedule.notes ?? '',
      tentative: Boolean(schedule.tentative) && exception?.kind !== 'confirmed',
      status: exception?.kind === 'cancelled' ? 'cancelled' : exception ? 'confirmed' : 'planned',
      schedule,
    });
  }
  for (const event of data.events) {
    if (isAllDay(event) || dayKey(new Date(event.start_at)) !== date) continue;
    const sameDay = dayKey(new Date(event.end_at)) === date;
    items.push({
      id: `event:${event.id}`,
      type: isBlock(event) ? 'block' : 'event',
      date,
      start: minutesOfDay(event.start_at),
      end: sameDay ? minutesOfDay(event.end_at) : 24 * 60,
      start_at: event.start_at,
      end_at: event.end_at,
      title: event.title,
      subject_id: event.subject_id,
      location: event.location,
      class_type: '',
      notes: '',
      tentative: false,
      status: 'planned',
      event,
    });
  }
  return items.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** All-day items: open tasks due that day and day-long events not linked to a known task. */
export function dayDeadlines(data: Bootstrap, date: string) {
  const tasks = data.tasks.filter((task) => task.due_date === date && !isDone(task));
  const events = data.events.filter(
    (event) =>
      isAllDay(event) &&
      dayKey(new Date(event.start_at)) === date &&
      !(event.task_id && data.tasks.some((task) => task.id === event.task_id)),
  );
  return { tasks, events };
}

/** Lays out overlapping items into side-by-side columns. */
export function layoutColumns(items: Occurrence[]) {
  const placed: { item: Occurrence; column: number; columns: number }[] = [];
  let cluster: typeof placed = [];
  let clusterEnd = -1;
  const flush = () => {
    const columns = Math.max(1, ...cluster.map((entry) => entry.column + 1));
    for (const entry of cluster) entry.columns = columns;
    placed.push(...cluster);
    cluster = [];
  };
  for (const item of items) {
    if (item.start >= clusterEnd && cluster.length) flush();
    const taken = new Set(
      cluster.filter((entry) => entry.item.end > item.start).map((entry) => entry.column),
    );
    let column = 0;
    while (taken.has(column)) column++;
    cluster.push({ item, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length) flush();
  return placed;
}

/** Semester start: the earliest Monday of a recurring class or the stored timetable start. */
export function semesterWeek(data: Bootstrap, date = todayKey()) {
  const starts = [
    ...data.schedules.map((schedule) => schedule.valid_from),
    ...data.timetables.map((timetable) => timetable.starts_on),
  ].sort();
  const ends = data.schedules.map((schedule) => schedule.valid_to).sort();
  if (!starts.length) return null;
  const first = mondayOf(addDays(starts[0]!, weekday(starts[0]!) === 7 ? 1 : 0));
  const end = ends.at(-1);
  if (date < first || (end && date > end)) return null;
  return Math.floor(daysBetween(first, mondayOf(date)) / 7) + 1;
}

export function nextClass(data: Bootstrap, from = new Date(), horizonDays = 14) {
  const today = dayKey(from);
  const now = minutesOfDay(from.toISOString());
  for (let offset = 0; offset < horizonDays; offset++) {
    const date = addDays(today, offset);
    const item = dayItems(data, date).find(
      (entry) =>
        entry.type === 'class' && entry.status !== 'cancelled' && (offset > 0 || entry.end > now),
    );
    if (item) return item;
  }
  return null;
}

export const occurrenceConflicts = (items: Occurrence[]) => {
  const conflicts = new Set<string>();
  const active = items.filter((item) => item.status !== 'cancelled');
  for (const a of active)
    for (const b of active)
      if (a.id !== b.id && a.start < b.end && b.start < a.end && !(a.tentative || b.tentative)) {
        conflicts.add(a.id);
        conflicts.add(b.id);
      }
  return conflicts;
};
