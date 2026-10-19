import type { Subject, TaskKind } from './types';
import { addDays, todayKey, weekday } from './time';

export type QuickTask = {
  title: string;
  due_date: string | null;
  kind: TaskKind;
  priority: 'low' | 'medium' | 'high';
  subject_id: string | null;
};

const fold = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

const WEEKDAY_WORDS: [RegExp, number][] = [
  [/^(pon|pn|poniedzialek|poniedzialku)$/, 1],
  [/^(wt|wtorek|wtorku)$/, 2],
  [/^(sr|sroda|srode|srody)$/, 3],
  [/^(czw|cz|czwartek|czwartku)$/, 4],
  [/^(pt|pia|piatek|piatku)$/, 5],
  [/^(sob|sb|sobota|sobote|soboty)$/, 6],
  [/^(nd|ndz|niedz|niedziela|niedziele|niedzieli)$/, 7],
];

export const kindFromText = (text: string): TaskKind => {
  const value = fold(text);
  if (/\begzamin/.test(value)) return 'exam';
  if (/\b(kolokwium|kolos|kartkowk|wejsciowk|test\b)/.test(value)) return 'colloquium';
  if (/\b(projekt|prezentacj|referat|raport|sprawozdani)/.test(value)) return 'project';
  return 'task';
};

export function matchSubject(subjects: Subject[], query: string): Subject | undefined {
  const q = fold(query);
  if (!q) return undefined;
  const initials = (name: string) =>
    fold(name)
      .split(/[\s—-]+/)
      .filter((word) => word.length > 2 || /^[a-z]{2,}$/i.test(word))
      .map((word) => word[0])
      .join('');
  return (
    subjects.find((s) => fold(s.name).startsWith(q)) ??
    subjects.find((s) =>
      fold(s.name)
        .split(/\s+/)
        .some((word) => word.startsWith(q)),
    ) ??
    subjects.find((s) => fold(s.name).includes(q)) ??
    subjects.find((s) => initials(s.name).startsWith(q))
  );
}

/** Parses "Kolokwium z wizji pt #percepcja !" into a task draft. Unknown words stay in the title. */
export function parseQuickTask(input: string, subjects: Subject[], today = todayKey()): QuickTask {
  const words = input.trim().split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  let due: string | null = null;
  let priority: QuickTask['priority'] = 'medium';
  let subject: Subject | undefined;
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    const value = fold(word).replace(/[.,;]$/, '');
    if (/^#\S+/.test(word)) {
      subject = matchSubject(subjects, word.slice(1)) ?? subject;
      if (!matchSubject(subjects, word.slice(1))) kept.push(word);
      continue;
    }
    if (/^!+$/.test(word)) {
      priority = 'high';
      continue;
    }
    if (value === 'dzis' || value === 'dzisiaj') {
      due = today;
      continue;
    }
    if (value === 'jutro') {
      due = addDays(today, 1);
      continue;
    }
    if (value === 'pojutrze') {
      due = addDays(today, 2);
      continue;
    }
    if (value === 'za' && words[index + 1]) {
      const next = fold(words[index + 1]!);
      const amount = Number(next);
      if (next === 'tydzien') {
        due = addDays(today, 7);
        index++;
        continue;
      }
      if (
        Number.isInteger(amount) &&
        amount > 0 &&
        /^dni|dzien/.test(fold(words[index + 2] ?? ''))
      ) {
        due = addDays(today, amount);
        index += 2;
        continue;
      }
    }
    const date = value.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
    if (date) {
      const [, d, m, y] = date;
      const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : Number(today.slice(0, 4));
      let key = `${year}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
      if (!y && key < today) key = `${year + 1}-${key.slice(5)}`;
      if (!Number.isNaN(Date.parse(`${key}T12:00:00Z`))) {
        due = key;
        continue;
      }
    }
    const day = WEEKDAY_WORDS.find(([pattern]) => pattern.test(value));
    if (day && (words.length > 1 || kept.length)) {
      const previous = fold(kept.at(-1) ?? '');
      if (['w', 'we', 'na', 'do'].includes(previous)) kept.pop();
      due = addDays(today, (day[1] - weekday(today) + 7) % 7);
      continue;
    }
    kept.push(word);
  }
  const title = kept
    .join(' ')
    .replace(/\s+([,.;])/g, '$1')
    .trim();
  return {
    title,
    due_date: due,
    kind: kindFromText(title),
    priority,
    subject_id: subject?.id ?? null,
  };
}
