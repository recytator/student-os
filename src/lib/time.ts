/** Calendar helpers. All calendar semantics are Europe/Warsaw; keys are YYYY-MM-DD. */
export const TZ = 'Europe/Warsaw';

const keyFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const clockFormatter = new Intl.DateTimeFormat('pl-PL', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
});

export const dayKey = (date: Date) => keyFormatter.format(date);
export const todayKey = () => dayKey(new Date());
export const fromKey = (key: string) => new Date(`${key}T12:00:00Z`);
export const addDays = (key: string, days: number) => {
  const date = fromKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
/** ISO weekday, 1 = Monday. */
export const weekday = (key: string) => fromKey(key).getUTCDay() || 7;
export const mondayOf = (key: string) => addDays(key, 1 - weekday(key));
export const daysBetween = (from: string, to: string) =>
  Math.round((fromKey(to).getTime() - fromKey(from).getTime()) / 86_400_000);

const offsetFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  timeZoneName: 'longOffset',
});
const offsetAt = (date: Date) =>
  offsetFormatter
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')
    ?.value.replace('GMT', '') || '+00:00';
export function warsawInstant(date: string, time: string): string {
  const first = `${date}T${time}:00${offsetAt(new Date(`${date}T${time}:00Z`))}`;
  // A guess near a DST switch can pick the neighbouring offset; re-check once.
  return clock(first) === time ? first : `${date}T${time}:00${offsetAt(new Date(first))}`;
}
export const clock = (instant: string) => clockFormatter.format(new Date(instant));
export const minutesOfDay = (instant: string) => {
  const [h, m] = clock(instant).split(':').map(Number);
  return h! * 60 + m!;
};
export const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
};

const formatter = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, ...options });
const longDay = formatter({ weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = formatter({ weekday: 'short', day: 'numeric', month: 'short' });
const numeric = formatter({ day: '2-digit', month: '2-digit', year: 'numeric' });
const dayMonth = formatter({ day: 'numeric', month: 'short' });
const monthYear = formatter({ month: 'long', year: 'numeric' });
const weekdayShort = formatter({ weekday: 'short' });
const weekdayLong = formatter({ weekday: 'long' });

export const fmt = {
  long: (key: string) => longDay.format(fromKey(key)),
  short: (key: string) => shortDay.format(fromKey(key)),
  numeric: (key: string) => numeric.format(fromKey(key)),
  dayMonth: (key: string) => dayMonth.format(fromKey(key)),
  monthYear: (key: string) => monthYear.format(fromKey(key)),
  weekdayShort: (key: string) => {
    const label = weekdayShort.format(fromKey(key)).replace('.', '');
    return label.charAt(0).toUpperCase() + label.slice(1);
  },
  weekdayLong: (key: string) => weekdayLong.format(fromKey(key)),
  instantDate: (instant: string) => numeric.format(new Date(instant)),
};
export const WEEKDAYS = [
  'Poniedziałek',
  'Wtorek',
  'Środa',
  'Czwartek',
  'Piątek',
  'Sobota',
  'Niedziela',
];
export const WEEKDAYS_SHORT = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];

export function plural(n: number, one: string, few: string, many: string) {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  const tens = abs % 100;
  const units = abs % 10;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
}

/** Human relative label for a due date. */
export function relativeDay(key: string, today = todayKey()) {
  const diff = daysBetween(today, key);
  if (diff === 0) return 'Dziś';
  if (diff === 1) return 'Jutro';
  if (diff === -1) return 'Wczoraj';
  if (diff > 1 && diff < 7) return fmt.weekdayLong(key);
  if (diff < 0) return `${-diff} ${plural(-diff, 'dzień', 'dni', 'dni')} temu`;
  return fmt.dayMonth(key);
}
export function countdown(key: string, today = todayKey()) {
  const diff = daysBetween(today, key);
  if (diff === 0) return 'dziś';
  if (diff === 1) return 'jutro';
  if (diff < 0) return `${-diff} ${plural(-diff, 'dzień', 'dni', 'dni')} temu`;
  return `za ${diff} ${plural(diff, 'dzień', 'dni', 'dni')}`;
}
export function duration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
