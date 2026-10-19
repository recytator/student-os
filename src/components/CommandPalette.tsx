import * as Dialog from '@radix-ui/react-dialog';
import {
  BookOpen,
  CalendarDays,
  FileText,
  LayoutGrid,
  ListTodo,
  Plus,
  Search,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import { parseQuickTask } from '../lib/quickadd';
import { isDone } from '../lib/schedule';
import { useStore, type Route } from '../lib/store';
import { relativeDay } from '../lib/time';

type Item = { id: string; icon: LucideIcon; label: string; hint?: string; run: () => void };
const fold = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, go, editTask, call } = useStore();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);
  const items = useMemo<Item[]>(() => {
    const close = () => onOpenChange(false);
    const q = fold(query.trim());
    const nav = (route: Route) => () => {
      go(route);
      close();
    };
    const pages: Item[] = [
      { id: 'p-today', icon: LayoutGrid, label: 'Dziś', run: nav({ page: 'today' }) },
      { id: 'p-plan', icon: CalendarDays, label: 'Plan', run: nav({ page: 'plan' }) },
      { id: 'p-tasks', icon: ListTodo, label: 'Zadania', run: nav({ page: 'tasks' }) },
      { id: 'p-materials', icon: FileText, label: 'Materiały', run: nav({ page: 'materials' }) },
      { id: 'p-subjects', icon: BookOpen, label: 'Przedmioty', run: nav({ page: 'subjects' }) },
      { id: 'p-settings', icon: Settings2, label: 'Ustawienia', run: nav({ page: 'settings' }) },
    ];
    const actions: Item[] = [
      {
        id: 'a-task',
        icon: Plus,
        label: 'Nowe zadanie',
        hint: 'N',
        run: () => {
          close();
          editTask('new');
        },
      },
      {
        id: 'a-upload',
        icon: Plus,
        label: 'Dodaj materiał (PDF, PPTX)',
        run: nav({ page: 'materials' }),
      },
    ];
    if (!q) return [...actions, ...pages];
    const match = (text: string) => fold(text).includes(q);
    const results: Item[] = [
      ...pages.filter((item) => match(item.label)),
      ...data.subjects
        .filter((s) => match(s.name))
        .slice(0, 5)
        .map((s) => ({
          id: `s-${s.id}`,
          icon: BookOpen,
          label: s.name,
          hint: 'Przedmiot',
          run: nav({ page: 'subject', id: s.id }),
        })),
      ...data.tasks
        .filter((t) => match(t.title))
        .sort((a, b) => Number(isDone(a)) - Number(isDone(b)))
        .slice(0, 6)
        .map((t) => ({
          id: `t-${t.id}`,
          icon: ListTodo,
          label: t.title,
          hint: isDone(t) ? 'Ukończone' : t.due_date ? relativeDay(t.due_date) : 'Zadanie',
          run: () => {
            close();
            editTask(t);
          },
        })),
      ...data.documents
        .filter(
          (d) =>
            match(d.name) || match(data.notes.find((n) => n.document_id === d.id)?.title ?? ''),
        )
        .slice(0, 5)
        .map((d) => ({
          id: `d-${d.id}`,
          icon: FileText,
          label: data.notes.find((n) => n.document_id === d.id)?.title || d.name,
          hint: 'Materiał',
          run: nav({ page: 'doc', id: d.id }),
        })),
    ];
    const draft = parseQuickTask(query, data.subjects);
    if (draft.title)
      results.push({
        id: 'a-quick',
        icon: Plus,
        label: `Dodaj zadanie: ${draft.title}`,
        hint: draft.due_date ? relativeDay(draft.due_date) : undefined,
        run: () => {
          close();
          void call('/tasks', 'POST', draft).catch(() => undefined);
        },
      });
    return results;
  }, [query, data, go, editTask, call, onOpenChange]);
  useEffect(() => setActive(0), [query]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="palette" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Szukaj i działaj</Dialog.Title>
          <div className="palette-input">
            <Search size={17} />
            <input
              autoFocus
              aria-label="Szukaj lub dodaj"
              placeholder="Szukaj zadań, przedmiotów, materiałów… albo wpisz nowe zadanie"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActive((index) => Math.min(items.length - 1, index + 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive((index) => Math.max(0, index - 1));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  items[active]?.run();
                }
              }}
            />
            <kbd>Esc</kbd>
          </div>
          <ul className="palette-list" role="listbox">
            {items.map((item, index) => (
              <li key={item.id} role="option" aria-selected={index === active}>
                <button
                  className={cn(index === active && 'active')}
                  onMouseEnter={() => setActive(index)}
                  onClick={item.run}
                >
                  <item.icon size={16} />
                  <span className="grow">{item.label}</span>
                  {item.hint && <span className="muted small">{item.hint}</span>}
                </button>
              </li>
            ))}
            {!items.length && <li className="muted small pad">Brak wyników</li>}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
