import { CheckCircle2, ListTodo, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { bucketTasks, KIND_LABEL, QuickAdd, TaskRow } from '../components/tasks';
import { Button, Card, Empty, PageHeader, Segmented } from '../components/ui';
import { isDone } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { TaskKind } from '../lib/types';

export function Tasks() {
  const { data, editTask } = useStore();
  const [status, setStatus] = useState<'open' | 'done'>('open');
  const [query, setQuery] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [kind, setKind] = useState<TaskKind | ''>('');
  const filtered = data.tasks.filter(
    (task) =>
      (status === 'done' ? isDone(task) : !isDone(task)) &&
      (!subjectId || task.subject_id === subjectId) &&
      (!kind || task.kind === kind) &&
      task.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const openCount = data.tasks.filter((task) => !isDone(task)).length;
  const doneCount = data.tasks.length - openCount;
  const groups =
    status === 'open'
      ? bucketTasks(filtered)
      : [
          {
            id: 'done',
            label: 'Ukończone',
            items: [...filtered].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
          },
        ];
  return (
    <div className="page">
      <PageHeader
        title="Zadania"
        subtitle={`${openCount} do zrobienia${doneCount ? ` · ${doneCount} ukończonych` : ''}`}
        actions={
          <Button variant="primary" onClick={() => editTask('new')}>
            <Plus size={15} /> Nowe zadanie
          </Button>
        }
      />
      <QuickAdd draft={{ subject_id: subjectId || null, kind: kind || undefined }} />
      <div className="filters">
        <Segmented
          label="Status zadań"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Do zrobienia' },
            { value: 'done', label: 'Ukończone' },
          ]}
        />
        <label className="search-input">
          <Search size={15} />
          <input
            aria-label="Szukaj zadania"
            placeholder="Szukaj…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Filtruj przedmiot"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
        >
          <option value="">Wszystkie przedmioty</option>
          {data.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtruj rodzaj"
          value={kind}
          onChange={(e) => setKind(e.target.value as TaskKind | '')}
        >
          <option value="">Każdy rodzaj</option>
          {(Object.keys(KIND_LABEL) as TaskKind[]).map((value) => (
            <option key={value} value={value}>
              {KIND_LABEL[value]}
            </option>
          ))}
        </select>
      </div>
      {groups.length ? (
        <div className="stack">
          {groups.map((group) => (
            <Card
              key={group.id}
              flush
              title={
                <span className={group.id === 'overdue' ? 'danger-text' : ''}>
                  {group.label} <span className="count">{group.items.length}</span>
                </span>
              }
            >
              {group.items.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <Empty
            icon={status === 'done' ? CheckCircle2 : ListTodo}
            title={
              query || subjectId || kind
                ? 'Brak pasujących zadań'
                : status === 'done'
                  ? 'Nic jeszcze nie ukończono'
                  : 'Wszystko zrobione'
            }
          >
            {query || subjectId || kind
              ? 'Zmień wyszukiwanie lub filtry.'
              : 'Wpisz zadanie w polu powyżej — rozpoznam termin („jutro”, „pt”, „12.11”), przedmiot (#nazwa) i rodzaj (kolokwium, egzamin, projekt).'}
          </Empty>
        </Card>
      )}
    </div>
  );
}
