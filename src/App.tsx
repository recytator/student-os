import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  Clock3,
  FileText,
  GraduationCap,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Workflow,
  X,
  AlertTriangle,
  Pencil,
  ExternalLink,
} from 'lucide-react';
import { api, ApiError, json } from './api';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './components/ui/button';
import type {
  Subject as SubjectRecord,
  Task as TaskRecord,
  CalendarEvent as EventRecord,
  ClassSchedule as ScheduleRecord,
  Preferences as PreferencesRecord,
  ProposedTask,
  StudyBlock,
  ReviewAgentOutput,
} from '../shared/contracts';

type Page = 'dashboard' | 'tasks' | 'calendar' | 'subjects' | 'documents' | 'activity' | 'settings';
type Subject = SubjectRecord;
type Task = TaskRecord & {
  source_page?: number | null;
  source_quote?: string | null;
  subtasks?: { id: string; title: string; status: string }[];
};
type Event = EventRecord;
type Schedule = ScheduleRecord;
type Document = {
  id: string;
  name?: string;
  filename?: string;
  title?: string;
  page_count?: number;
  created_at: string;
  subject_id?: string | null;
};
type Run = {
  id: string;
  document_id: string;
  state: string;
  status?: string;
  created_at: string;
  updated_at?: string;
  error?: string;
  model?: string;
  current_agent?: string;
};
type Preferences = PreferencesRecord;
type Bootstrap = {
  user: { name?: string; github_login?: string; avatar_url?: string };
  subjects: Subject[];
  tasks: Task[];
  events: Event[];
  schedules: Schedule[];
  documents: Document[];
  runs: Run[];
  preferences: Preferences;
};
type RunDetail = {
  run: Run;
  steps: Record<string, unknown>[];
  result: { proposals: ProposedTask[]; blocks: StudyBlock[]; review: ReviewAgentOutput } | null;
};
const NAV: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Przegląd', icon: LayoutDashboard },
  { id: 'calendar', label: 'Kalendarz', icon: CalendarDays },
  { id: 'tasks', label: 'Zadania', icon: ListTodo },
  { id: 'subjects', label: 'Przedmioty', icon: BookOpen },
  { id: 'documents', label: 'Dokumenty', icon: FileText },
  { id: 'activity', label: 'Agenci', icon: Workflow },
];
const COLORS = ['#a6a0ed', '#77b8ae', '#e5ad79', '#8aa9dd', '#d58fa5', '#a7b57b'];
const dateFormatter = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Warsaw',
});
const timeFormatter = new Intl.DateTimeFormat('pl-PL', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Warsaw',
});
const dayKey = (date: Date) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
const dateText = (value?: string | null) =>
  value ? dateFormatter.format(new Date(value)) : 'Bez terminu';
const timeText = (value: string) => timeFormatter.format(new Date(value));
const datetimeInput = (value?: string | null) =>
  value ? `${dayKey(new Date(value))}T${timeText(value)}` : '';
const priorityLabel = (value: string) =>
  ({ low: 'Niski', medium: 'Normalny', high: 'Wysoki', urgent: 'Pilny' })[value] ?? value;
const stateLabel = (value: string) =>
  ({
    queued: 'Oczekuje',
    document: 'Analiza dokumentu',
    deadline: 'Wydobywanie terminów',
    planner: 'Planowanie',
    review: 'Weryfikacja',
    awaiting_approval: 'Do zatwierdzenia',
    completed: 'Zakończono',
    failed: 'Błąd',
    approval: 'Do zatwierdzenia',
    committed: 'Zatwierdzono',
    cancelled: 'Anulowano',
    document_agent: 'DocumentAgent',
    deadline_agent: 'DeadlineAgent',
    planner_agent: 'PlannerAgent',
    review_agent: 'ReviewAgent',
    pending: 'Oczekuje',
    running: 'W trakcie',
    approved: 'Zatwierdzono',
  })[value] ?? value;
function Empty({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: typeof FileText;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={23} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function SectionTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>(() => {
    const hash = location.hash.slice(1);
    return [...NAV.map((n) => n.id), 'settings'].includes(hash) ? (hash as Page) : 'dashboard';
  });
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [taskEditor, setTaskEditor] = useState<Task | null | 'new'>(null);
  const refresh = useCallback(async () => {
    try {
      const result = await api<Bootstrap>('/bootstrap');
      setData({ ...result, preferences: result.preferences ?? {} });
      setUnauthorized(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUnauthorized(true);
      else setError(e instanceof Error ? e.message : 'Nie udało się pobrać danych.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const change = () => {
      const next = location.hash.slice(1);
      if ([...NAV.map((n) => n.id), 'settings'].includes(next)) setPage(next as Page);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const navigate = (next: Page) => {
    location.hash = next;
    setPage(next);
    setMore(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const mutate = async (path: string, method: string, value?: unknown) => {
    setBusy(true);
    setError('');
    try {
      const result = await api<unknown>(path, {
        method,
        body: value === undefined ? undefined : json(value),
      });
      await refresh();
      if (
        result &&
        typeof result === 'object' &&
        'warnings' in result &&
        Array.isArray(result.warnings)
      ) {
        setNotice(result.warnings.join(' '));
        window.setTimeout(() => setNotice(''), 7000);
      }
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operacja nie powiodła się.');
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const logout = () => {
    void api('/auth/logout', { method: 'POST' })
      .then(() => location.reload())
      .catch((e) => setError(e instanceof Error ? e.message : 'Wylogowanie nie powiodło się.'));
  };
  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4500);
  };
  const remove = async (path: string, description: string) => {
    if (window.confirm(description)) await mutate(path, 'DELETE').catch(() => undefined);
  };
  if (loading)
    return (
      <div className="initial-screen">
        <GraduationCap size={36} />
        <h1>
          StudentOS<span className="brand-dot">.</span>
        </h1>
        <p>
          <LoaderCircle className="spin" size={16} /> Przygotowuję Twoją przestrzeń
        </p>
      </div>
    );
  if (unauthorized)
    return (
      <div className="login-screen">
        <div className="login-brand">
          <GraduationCap size={26} /> StudentOS<span className="brand-dot">.</span>
        </div>
        <main className="login-card">
          <span className="eyebrow">TWOJA PRZESTRZEŃ DO NAUKI</span>
          <h1>
            Mniej chaosu.
            <br />
            Więcej skupienia.
          </h1>
          <p>
            Plan zajęć, zadania i materiały w jednym miejscu. Czterej agenci pomagają odnaleźć
            terminy — decyzje należą do Ciebie.
          </p>
          <a className="button primary login-button" href="/api/auth/login">
            Zaloguj przez GitHub <ArrowUpRight size={18} />
          </a>
          <div className="login-security">
            <ShieldCheck size={16} /> Prywatne dane. Bezpieczna sesja. Bez dostępu do repozytoriów.
          </div>
          {error && <div className="alert error">{error}</div>}
        </main>
        <p className="login-footer">Zaprojektowany wokół Twojego dnia.</p>
      </div>
    );
  if (!data)
    return (
      <div className="initial-screen">
        <AlertTriangle size={30} />
        <h2>Nie udało się otworzyć StudentOS</h2>
        <p>{error}</p>
        <Button
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
        >
          Spróbuj ponownie
        </Button>
      </div>
    );
  const subject = (id?: string | null) => data.subjects.find((item) => item.id === id);
  const openTasks = data.tasks.filter((task) => !['done', 'completed'].includes(task.status));
  const shellProps = { data, mutate, remove, busy, subject, notify, refresh };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Przejdź do treści
      </a>
      <aside className="sidebar">
        <a href="#dashboard" className="brand" onClick={() => navigate('dashboard')}>
          <span className="brand-symbol">
            <GraduationCap size={22} />
          </span>
          StudentOS<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">TWOJA PRZESTRZEŃ</div>
        <nav aria-label="Nawigacja główna">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === 'tasks' && openTasks.length > 0 && (
                <span className="nav-count">{openTasks.length}</span>
              )}
              {item.id === 'activity' && <span className="tiny-status" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div>
            <Sparkles size={16} />
            <span>Twój zespół AI</span>
          </div>
          <p>
            Od dokumentu do planu.
            <br />
            Zawsze pod Twoją kontrolą.
          </p>
          <button onClick={() => navigate('activity')}>
            Zobacz aktywność <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={18} />
            Ustawienia
          </button>
          <div className="user-chip">
            <div className="avatar">
              {(data.user.name ?? data.user.github_login ?? 'S').slice(0, 1).toUpperCase()}
            </div>
            <div>
              <strong>{data.user.name ?? data.user.github_login ?? 'Student'}</strong>
              <span>Osobista przestrzeń</span>
            </div>
            <button className="icon-button" onClick={logout} aria-label="Wyloguj" title="Wyloguj">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Moje studia</span>
            <ChevronRight size={13} />
            <strong>{NAV.find((n) => n.id === page)?.label ?? 'Ustawienia'}</strong>
          </div>
          <div className="topbar-right">
            <span className="timezone">
              <Clock3 size={13} /> Warszawa
            </span>
            <button
              className="quick-add"
              aria-label="Nowe zadanie"
              onClick={() => setTaskEditor('new')}
            >
              <Plus size={16} />
              <span>Nowe zadanie</span>
            </button>
          </div>
        </header>
        <main id="main" className="page-content">
          {data.user.github_login === 'local' && (
            <div className="dev-banner">
              <ShieldCheck size={15} />
              <span>
                Środowisko lokalne · sesja developerska. Logowanie GitHub i rzeczywiste wywołania AI
                wymagają konfiguracji usług.
              </span>
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
              <button onClick={() => setError('')} aria-label="Zamknij komunikat">
                <X size={17} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <Check size={17} />
              {notice}
            </div>
          )}
          {page === 'dashboard' && (
            <Dashboard {...shellProps} navigate={navigate} editTask={setTaskEditor} />
          )}{' '}
          {page === 'tasks' && <Tasks {...shellProps} editTask={setTaskEditor} />}{' '}
          {page === 'subjects' && <Subjects {...shellProps} />}{' '}
          {page === 'calendar' && <Calendar {...shellProps} />}{' '}
          {page === 'documents' && <Documents {...shellProps} navigate={navigate} />}{' '}
          {page === 'activity' && <Activity {...shellProps} />}{' '}
          {page === 'settings' && <Settings {...shellProps} />}
        </main>
        <footer className="app-footer">
          <span>StudentOS</span>
          <span>Twój rytm. Twój plan.</span>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label="Nawigacja mobilna">
        {NAV.filter((n) => ['dashboard', 'calendar', 'tasks', 'documents'].includes(n.id)).map(
          (item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={page === item.id ? 'active' : ''}
            >
              <item.icon size={21} />
              <span>{item.label}</span>
            </button>
          ),
        )}
        <button
          onClick={() => setMore(!more)}
          className={more || ['subjects', 'activity', 'settings'].includes(page) ? 'active' : ''}
          aria-expanded={more}
        >
          <MoreHorizontal size={22} />
          <span>Więcej</span>
        </button>
      </nav>
      {more && (
        <div className="mobile-more">
          <div className="mobile-more-heading">
            Twoja przestrzeń
            <button aria-label="Zamknij" onClick={() => setMore(false)}>
              <X size={18} />
            </button>
          </div>
          {[
            ...NAV.filter((n) => ['subjects', 'activity'].includes(n.id)),
            { id: 'settings' as Page, label: 'Ustawienia', icon: Settings2 },
          ].map((n) => (
            <button key={n.id} onClick={() => navigate(n.id)}>
              <n.icon size={21} />
              {n.label}
              <ChevronRight size={17} />
            </button>
          ))}
          <button onClick={logout}>
            <LogOut size={20} />
            Wyloguj
          </button>
        </div>
      )}
      {taskEditor && (
        <TaskEditor {...shellProps} task={taskEditor} onClose={() => setTaskEditor(null)} />
      )}
    </div>
  );
}
type SharedProps = {
  data: Bootstrap;
  mutate: (path: string, method: string, value?: unknown) => Promise<unknown>;
  remove: (path: string, description: string) => Promise<void>;
  busy: boolean;
  subject: (id?: string | null) => Subject | undefined;
  notify: (message: string) => void;
  refresh: () => Promise<void>;
};
function SubjectLabel({ value }: { value?: Subject }) {
  return value ? (
    <span className="subject-label">
      <i style={{ background: value.color }} />
      {value.name}
    </span>
  ) : (
    <span className="subtle">Ogólne</span>
  );
}
function TaskRow({
  task,
  subject,
  onEdit,
  onToggle,
}: {
  task: Task;
  subject?: Subject;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const done = ['done', 'completed'].includes(task.status);
  const overdue = task.due_date && !done && task.due_date < dayKey(new Date());
  return (
    <div className={`task-row ${done ? 'is-done' : ''}`}>
      <button
        className="task-check"
        aria-label={done ? 'Oznacz jako niewykonane' : 'Ukończ zadanie'}
        onClick={onToggle}
      >
        {done ? <Check size={14} /> : null}
      </button>
      <button className="task-main" onClick={onEdit}>
        <strong>{task.title}</strong>
        <div>
          <SubjectLabel value={subject} />
          {task.source_page && (
            <span className="source-mini">
              <FileText size={11} />
              s. {task.source_page}
            </span>
          )}
        </div>
      </button>
      <div className="task-meta">
        {['high', 'urgent'].includes(task.priority) && (
          <span className={`priority-dot ${task.priority}`} title={priorityLabel(task.priority)} />
        )}
        <span className={overdue ? 'overdue' : ''}>
          {task.due_date ? dateText(task.due_date) : 'Bez terminu'}
        </span>
        <ChevronRight size={15} />
      </div>
    </div>
  );
}
function Dashboard({
  data,
  mutate,
  subject,
  navigate,
  editTask,
}: SharedProps & { navigate: (page: Page) => void; editTask: (task: Task | 'new') => void }) {
  const today = dayKey(new Date());
  const upcoming = data.tasks
    .filter((t) => !['done', 'completed'].includes(t.status))
    .sort((a, b) => (a.due_date ?? 'z').localeCompare(b.due_date ?? 'z'))
    .slice(0, 5);
  const complete = data.tasks.filter((t) => ['done', 'completed'].includes(t.status)).length;
  const todaysEvents = expandSchedules(data.events, data.schedules, data.subjects, new Date())
    .filter((e) => dayKey(new Date(e.start_at)) === today)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const nextEvent = todaysEvents.find((e) => new Date(e.end_at).getTime() > Date.now());
  const dateLabel = new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Warsaw',
  }).format(new Date());
  return (
    <>
      <SectionTitle
        eyebrow={dateLabel.toLocaleUpperCase('pl')}
        title={`Dzień dobry${data.user.name ? `, ${data.user.name.split(' ')[0]}` : ''}.`}
        description="Zrób miejsce na to, co dziś najważniejsze."
        action={
          <Button kind="secondary" onClick={() => navigate('calendar')}>
            <CalendarDays size={16} />
            Twój plan <ArrowUpRight size={15} />
          </Button>
        }
      />
      <div className="overview-strip">
        <div>
          <span className="metric-icon lavender">
            <ListTodo size={18} />
          </span>
          <div>
            <span>Do zrobienia</span>
            <strong>
              {data.tasks.length - complete}
              <small> zadań</small>
            </strong>
          </div>
        </div>
        <div>
          <span className="metric-icon green">
            <CalendarDays size={18} />
          </span>
          <div>
            <span>Dzisiaj w planie</span>
            <strong>
              {todaysEvents.length}
              <small> wydarzeń</small>
            </strong>
          </div>
        </div>
        <div>
          <span className="metric-icon peach">
            <CheckCheck size={18} />
          </span>
          <div>
            <span>Ukończone zadania</span>
            <strong>
              {complete}
              <small> / {data.tasks.length}</small>
            </strong>
          </div>
          <div className="mini-progress">
            <span
              style={{ width: `${data.tasks.length ? (complete / data.tasks.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>
      <div className="dashboard-grid">
        <section className="panel task-panel">
          <div className="panel-heading">
            <h2>
              Na Twojej liście <span>{upcoming.length}</span>
            </h2>
            <button className="text-button" onClick={() => navigate('tasks')}>
              Wszystkie zadania <ArrowUpRight size={14} />
            </button>
          </div>
          {upcoming.length ? (
            upcoming.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                subject={subject(task.subject_id)}
                onEdit={() => editTask(task)}
                onToggle={() => {
                  void mutate(`/tasks/${task.id}`, 'PATCH', { status: 'done' }).catch(
                    () => undefined,
                  );
                }}
              />
            ))
          ) : (
            <Empty
              icon={ListTodo}
              title="Czysta lista, dobry początek"
              action={
                <Button kind="secondary" onClick={() => editTask('new')}>
                  <Plus size={16} />
                  Dodaj pierwsze zadanie
                </Button>
              }
            >
              Zapisz obowiązki i zostaw sobie przestrzeń na skupienie.
            </Empty>
          )}
          <button className="add-row" onClick={() => editTask('new')}>
            <Plus size={16} />
            Dodaj zadanie
          </button>
        </section>
        <section className="panel today-panel">
          <div className="panel-heading">
            <h2>Dzisiaj</h2>
            <span className="subtle">{dateText(today + 'T12:00:00Z')}</span>
          </div>
          {todaysEvents.length ? (
            <div className="day-timeline">
              {todaysEvents.map((event) => (
                <div
                  className={`timeline-event ${event.id === nextEvent?.id ? 'next' : ''}`}
                  key={event.id}
                >
                  <div className="timeline-time">
                    {timeText(event.start_at)}
                    <span>{timeText(event.end_at)}</span>
                  </div>
                  <div
                    className="timeline-line"
                    style={{ background: subject(event.subject_id)?.color ?? COLORS[0] }}
                  />
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.location || subject(event.subject_id)?.name || 'Wydarzenie'}</p>
                    {event.id === nextEvent?.id && (
                      <Badge tone="lavender">
                        {new Date(event.start_at).getTime() < Date.now() ? 'Teraz' : 'Następne'}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={CalendarDays} title="Dzień bez zajęć">
              Dodaj plan zajęć lub zaplanuj własny blok nauki.
            </Empty>
          )}
          <button className="panel-footer-link" onClick={() => navigate('calendar')}>
            Otwórz kalendarz
            <ArrowRight size={15} />
          </button>
        </section>
        <section className="panel documents-callout">
          <div className="document-illustration">
            <FileText size={28} />
            <span>
              <Sparkles size={13} />
            </span>
          </div>
          <div>
            <span className="eyebrow">OD MATERIAŁÓW DO DZIAŁANIA</span>
            <h2>Sylabus ma plan. Odkryj go.</h2>
            <p>Dodaj PDF. Agenci odnajdą obowiązki, sprawdzą źródła i zaproponują harmonogram.</p>
          </div>
          <Button kind="secondary" onClick={() => navigate('documents')}>
            <Upload size={16} />
            Dodaj dokument
          </Button>
        </section>
        <section className="panel recent-panel">
          <div className="panel-heading">
            <h2>Ostatnia aktywność agentów</h2>
            <button
              className="icon-button"
              aria-label="Otwórz aktywność agentów"
              onClick={() => navigate('activity')}
            >
              <ArrowUpRight size={17} />
            </button>
          </div>
          {data.runs.length ? (
            <div className="compact-list">
              {data.runs.slice(0, 3).map((run) => (
                <button key={run.id} onClick={() => navigate('activity')}>
                  <Workflow size={17} />
                  <div>
                    <strong>
                      {data.documents.find((d) => d.id === run.document_id)?.filename ??
                        data.documents.find((d) => d.id === run.document_id)?.name ??
                        'Analiza dokumentu'}
                    </strong>
                    <span>{dateText(run.created_at)}</span>
                  </div>
                  <Badge tone={run.state === 'failed' ? 'red' : 'lavender'}>
                    {stateLabel(run.state)}
                  </Badge>
                </button>
              ))}
            </div>
          ) : (
            <div className="quiet-empty">
              <Workflow size={20} />
              <p>
                Historia pojawi się po pierwszej analizie.
                <br />
                <span>Rzeczywiste etapy, źródła i wyniki.</span>
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
function Tasks({
  data,
  subject,
  mutate,
  editTask,
}: SharedProps & { editTask: (task: Task | 'new') => void }) {
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [group, setGroup] = useState(false);
  const tasks = data.tasks
    .filter(
      (t) =>
        (filter === 'all' ||
          (filter === 'done'
            ? ['done', 'completed'].includes(t.status)
            : !['done', 'completed'].includes(t.status))) &&
        t.title.toLowerCase().includes(search.toLowerCase()) &&
        (!subjectFilter || t.subject_id === subjectFilter),
    )
    .sort((a, b) => (a.due_date ?? 'z').localeCompare(b.due_date ?? 'z'));
  const groups = group
    ? [
        ...data.subjects.map((s) => ({
          name: s.name,
          items: tasks.filter((t) => t.subject_id === s.id),
        })),
        { name: 'Ogólne', items: tasks.filter((t) => !t.subject_id) },
      ].filter((g) => g.items.length)
    : [{ name: '', items: tasks }];
  return (
    <>
      <SectionTitle
        eyebrow="MAŁE KROKI, REALNY POSTĘP"
        title="Zadania"
        description="Wszystko, o czym chcesz pamiętać."
        action={
          <Button onClick={() => editTask('new')}>
            <Plus size={16} />
            Nowe zadanie
          </Button>
        }
      />
      <div className="toolbar">
        <div className="tabs">
          {[
            ['active', 'Do zrobienia'],
            ['done', 'Ukończone'],
            ['all', 'Wszystkie'],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? 'active' : ''}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar-fields">
          <label className="search">
            <Search size={16} />
            <input
              aria-label="Szukaj zadania"
              placeholder="Szukaj zadania…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="Filtruj przedmiot"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
          >
            <option value="">Wszystkie przedmioty</option>
            {data.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            className={`button secondary ${group ? 'selected' : ''}`}
            onClick={() => setGroup(!group)}
            title="Grupuj według przedmiotu"
          >
            <BookOpen size={16} />
            <span>Grupuj</span>
          </button>
        </div>
      </div>
      {tasks.length ? (
        groups.map((g) => (
          <section className="panel task-group" key={g.name}>
            {g.name && (
              <div className="panel-heading">
                <h2>{g.name}</h2>
                <Badge>{g.items.length}</Badge>
              </div>
            )}
            {g.items.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                subject={subject(task.subject_id)}
                onEdit={() => editTask(task)}
                onToggle={() => {
                  void mutate(`/tasks/${task.id}`, 'PATCH', {
                    status: ['done', 'completed'].includes(task.status) ? 'todo' : 'done',
                  }).catch(() => undefined);
                }}
              />
            ))}
          </section>
        ))
      ) : (
        <section className="panel">
          <Empty
            icon={ListTodo}
            title={
              search || subjectFilter
                ? 'Brak pasujących zadań'
                : filter === 'done'
                  ? 'Pierwsze ukończenie przed Tobą'
                  : 'Masz przestrzeń na coś nowego'
            }
            action={
              filter !== 'done' ? (
                <Button kind="secondary" onClick={() => editTask('new')}>
                  <Plus size={16} />
                  Dodaj zadanie
                </Button>
              ) : undefined
            }
          >
            {search || subjectFilter
              ? 'Zmień wyszukiwanie lub filtry.'
              : 'Dodawaj zadania ręcznie lub utwórz je z analizy dokumentu.'}
          </Empty>
        </section>
      )}
    </>
  );
}
function TaskEditor({
  data,
  task,
  mutate,
  remove,
  busy,
  onClose,
}: SharedProps & { task: Task | 'new'; onClose: () => void }) {
  const existing = task !== 'new' ? task : null;
  const metadata = taskMetadata(existing?.notes);
  const [subtasks, setSubtasks] = useState<{ id: string; title: string; status: string }[]>([]);
  const reloadSubtasks = () => {
    if (existing)
      void api<{ items: { id: string; title: string; status: string }[] }>(
        `/tasks/${existing.id}/subtasks`,
      )
        .then((result) => setSubtasks(result.items))
        .catch(() => undefined);
  };
  useEffect(reloadSubtasks, [existing?.id]);
  const [localError, setLocalError] = useState('');
  const [subtask, setSubtask] = useState('');
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLocalError('');
    const values = new FormData(e.currentTarget);
    const due = String(values.get('due_date') || '');
    try {
      await mutate(existing ? `/tasks/${existing.id}` : '/tasks', existing ? 'PATCH' : 'POST', {
        title: values.get('title'),
        notes: values.get('notes') || '',
        subject_id: values.get('subject_id') || null,
        priority: values.get('priority'),
        due_date: due || null,
        status: values.get('status'),
      });
      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Nie udało się zapisać zadania.');
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop">
          <Dialog.Content aria-describedby={undefined} className="dialog">
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">TWOJA LISTA</span>
                <Dialog.Title asChild>
                  <h2 id="task-dialog-title">{existing ? 'Edytuj zadanie' : 'Nowe zadanie'}</h2>
                </Dialog.Title>
              </div>
              <button className="icon-button" onClick={onClose} aria-label="Zamknij">
                <X size={21} />
              </button>
            </div>
            <form onSubmit={save}>
              <Field label="Co chcesz zrobić?">
                <input
                  name="title"
                  autoFocus
                  required
                  maxLength={200}
                  placeholder="Np. przygotować projekt z robotyki"
                  defaultValue={existing?.title}
                />
              </Field>
              <Field label="Opis">
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={5000}
                  placeholder="Szczegóły, pomysły, kolejne kroki…"
                  defaultValue={metadata?.user_notes ?? (metadata ? '' : (existing?.notes ?? ''))}
                />
              </Field>
              <div className="form-grid">
                <Field label="Przedmiot">
                  <select name="subject_id" defaultValue={existing?.subject_id ?? ''}>
                    <option value="">Ogólne</option>
                    {data.subjects.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Termin">
                  <input type="date" name="due_date" defaultValue={existing?.due_date ?? ''} />
                </Field>
                <Field label="Priorytet">
                  <select name="priority" defaultValue={existing?.priority ?? 'medium'}>
                    {['low', 'medium', 'high'].map((p) => (
                      <option value={p} key={p}>
                        {priorityLabel(p)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select name="status" defaultValue={existing?.status ?? 'todo'}>
                    <option value="todo">Do zrobienia</option>
                    <option value="done">Ukończone</option>
                  </select>
                </Field>
              </div>
              {metadata?.sources?.map((source, index) => (
                <div key={index} className="source-box">
                  <FileText size={16} />
                  <div>
                    <strong>Źródło · strona {source.page}</strong>
                    <p>„{source.quote}”</p>
                  </div>
                </div>
              ))}
              {metadata?.warning && <p className="warning-text">{metadata.warning}</p>}
              {existing?.document_id && (
                <a href="#documents" className="text-button" onClick={onClose}>
                  <FileText size={14} />
                  Otwórz materiały źródłowe
                  <ArrowUpRight size={13} />
                </a>
              )}
              {existing && (
                <div className="subtasks">
                  <h3>Podzadania</h3>
                  {subtasks.map((sub) => (
                    <div key={sub.id} className="subtask-row">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Zmień status podzadania"
                        onClick={() => {
                          void mutate(`/tasks/${existing.id}/subtasks/${sub.id}`, 'PATCH', {
                            status: sub.status === 'done' ? 'todo' : 'done',
                          })
                            .then(reloadSubtasks)
                            .catch(() => undefined);
                        }}
                      >
                        {sub.status === 'done' ? <CheckCheck size={17} /> : <Circle size={17} />}
                      </button>
                      <span>{sub.title}</span>
                      <button
                        className="icon-button danger-text"
                        aria-label="Usuń podzadanie"
                        type="button"
                        onClick={() => {
                          void remove(
                            `/tasks/${existing.id}/subtasks/${sub.id}`,
                            'Usunąć podzadanie?',
                          ).then(reloadSubtasks);
                        }}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                  <div className="inline-add">
                    <input
                      aria-label="Nowe podzadanie"
                      placeholder="Dodaj mały krok…"
                      value={subtask}
                      onChange={(e) => setSubtask(e.target.value)}
                    />
                    <Button
                      kind="secondary"
                      disabled={!subtask.trim() || busy}
                      onClick={() => {
                        void mutate(`/tasks/${existing.id}/subtasks`, 'POST', { title: subtask })
                          .then(() => {
                            setSubtask('');
                            reloadSubtasks();
                          })
                          .catch(() => undefined);
                      }}
                    >
                      <Plus size={16} />
                    </Button>
                  </div>
                </div>
              )}
              {localError && <div className="alert error">{localError}</div>}
              <div className="dialog-actions">
                {existing ? (
                  <Button
                    kind="danger"
                    disabled={busy}
                    onClick={() => {
                      void remove(
                        `/tasks/${existing.id}`,
                        'Usunąć zadanie i wszystkie podzadania?',
                      ).then(onClose);
                    }}
                  >
                    <Trash2 size={16} />
                    Usuń
                  </Button>
                ) : (
                  <span />
                )}
                <div>
                  <Button kind="ghost" onClick={onClose}>
                    Anuluj
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Zapisz
                    zadanie
                  </Button>
                </div>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function Subjects({ data, mutate, remove, busy, notify }: SharedProps) {
  const [editing, setEditing] = useState<Subject | null | 'new'>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [localError, setLocalError] = useState('');
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLocalError('');
    const values = new FormData(e.currentTarget);
    try {
      await mutate(
        editing && editing !== 'new' ? `/subjects/${editing.id}` : '/subjects',
        editing && editing !== 'new' ? 'PATCH' : 'POST',
        {
          name: values.get('name'),
          teacher: values.get('teacher') || '',
          class_type: values.get('class_type'),
          color,
        },
      );
      setEditing(null);
      notify('Przedmiot zapisany.');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Nie udało się zapisać.');
    }
  };
  return (
    <>
      <SectionTitle
        eyebrow="WSZYSTKO NA SWOIM MIEJSCU"
        title="Przedmioty"
        description="Materiały, obowiązki i zajęcia połączone wspólnym kontekstem."
        action={
          <Button
            onClick={() => {
              setColor(COLORS[data.subjects.length % COLORS.length]);
              setEditing('new');
            }}
          >
            <Plus size={16} />
            Nowy przedmiot
          </Button>
        }
      />
      {editing && (
        <section className="panel editor-panel">
          <div className="panel-heading">
            <h2>{editing === 'new' ? 'Dodaj przedmiot' : 'Edytuj przedmiot'}</h2>
            <button
              className="icon-button"
              aria-label="Zamknij edycję"
              onClick={() => setEditing(null)}
            >
              <X size={18} />
            </button>
          </div>
          <form onSubmit={save}>
            <div className="form-grid">
              <Field label="Nazwa przedmiotu">
                <input
                  name="name"
                  autoFocus
                  required
                  maxLength={240}
                  defaultValue={editing === 'new' ? '' : editing.name}
                  placeholder="Np. Systemy autonomiczne"
                />
              </Field>
              <Field label="Prowadzący">
                <input
                  name="teacher"
                  maxLength={160}
                  defaultValue={editing === 'new' ? '' : editing.teacher}
                  placeholder="Opcjonalnie"
                />
              </Field>
              <Field label="Typ zajęć">
                <select
                  name="class_type"
                  defaultValue={editing === 'new' ? 'wykład' : editing.class_type}
                >
                  {['wykład', 'ćwiczenia', 'laboratorium', 'projekt', 'seminarium', 'inne'].map(
                    (type) => (
                      <option key={type}>{type}</option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="Kolor">
                <div className="color-picker">
                  {COLORS.map((c) => (
                    <button
                      type="button"
                      aria-label={`Kolor ${c}`}
                      key={c}
                      onClick={() => setColor(c)}
                      style={{ background: c }}
                      className={color === c ? 'selected' : ''}
                    >
                      {color === c && <Check size={17} />}
                    </button>
                  ))}
                  <input
                    aria-label="Własny kolor"
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                </div>
              </Field>
            </div>
            {localError && <div className="alert error">{localError}</div>}
            <div className="form-actions">
              <Button kind="ghost" onClick={() => setEditing(null)}>
                Anuluj
              </Button>
              <Button type="submit" disabled={busy}>
                <Check size={16} />
                Zapisz przedmiot
              </Button>
            </div>
          </form>
        </section>
      )}
      {data.subjects.length ? (
        <div className="subject-grid">
          {data.subjects.map((item) => {
            const tasks = data.tasks.filter((t) => t.subject_id === item.id);
            return (
              <article className="panel subject-card" key={item.id}>
                <div className="subject-card-top">
                  <div
                    className="subject-icon"
                    style={{ color: item.color, background: `${item.color}15` }}
                  >
                    <BookOpen size={22} />
                  </div>
                  <div className="card-actions">
                    <button
                      className="icon-button"
                      title="Edytuj przedmiot"
                      aria-label={`Edytuj ${item.name}`}
                      onClick={() => {
                        setColor(item.color);
                        setEditing(item);
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button danger-text"
                      title="Usuń przedmiot"
                      aria-label={`Usuń ${item.name}`}
                      onClick={() => {
                        void remove(
                          `/subjects/${item.id}`,
                          'Usunąć przedmiot? Powiązane zadania pozostaną bez przedmiotu, a jego plan zajęć zostanie usunięty.',
                        );
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <h2>{item.name}</h2>
                <p>{item.teacher || 'Nie dodano prowadzącego'}</p>
                <Badge>{item.class_type}</Badge>
                <div className="subject-card-stats">
                  <span>
                    <ListTodo size={14} />
                    {tasks.filter((t) => t.status !== 'done').length} zadań
                  </span>
                  <span>
                    <FileText size={14} />
                    {data.documents.filter((d) => d.subject_id === item.id).length} materiałów
                  </span>
                  <span>
                    <CalendarDays size={14} />
                    {data.schedules.filter((s) => s.subject_id === item.id).length} zajęć
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        !editing && (
          <section className="panel">
            <Empty
              icon={BookOpen}
              title="Twój semestr zaczyna się tutaj"
              action={
                <Button kind="secondary" onClick={() => setEditing('new')}>
                  <Plus size={16} />
                  Dodaj pierwszy przedmiot
                </Button>
              }
            >
              Dodaj przedmioty, aby łatwiej uporządkować zadania, plan zajęć i materiały.
            </Empty>
          </section>
        )
      )}
    </>
  );
}

function warsawInstant(date: string, time: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    timeZoneName: 'longOffset',
  }).formatToParts(guess);
  const offset = parts.find((p) => p.type === 'timeZoneName')?.value.replace('GMT', '') || '+00:00';
  return `${date}T${time}:00${offset}`;
}
function expandSchedules(
  events: Event[],
  schedules: Schedule[],
  subjects: Subject[],
  selected: Date,
): Event[] {
  const start = new Date(`${dayKey(selected)}T12:00:00Z`);
  const mondayOffset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  const recurring: Event[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + i);
    const key = dayKey(date);
    for (const schedule of schedules) {
      if (schedule.weekday !== i + 1 || key < schedule.valid_from || key > schedule.valid_to)
        continue;
      recurring.push({
        id: `schedule:${schedule.id}:${key}`,
        user_id: '',
        created_at: '',
        updated_at: '',
        subject_id: schedule.subject_id,
        title: subjects.find((s) => s.id === schedule.subject_id)?.name ?? 'Zajęcia',
        start_at: warsawInstant(key, schedule.start_time),
        end_at: warsawInstant(key, schedule.end_time),
        location: schedule.location,
        document_id: null,
      });
    }
  }
  return [...events, ...recurring];
}
function Calendar({ data, subject, mutate, remove, busy, notify }: SharedProps) {
  const [view, setView] = useState<'day' | 'week'>('week');
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [editing, setEditing] = useState<Event | null | 'new'>(null);
  const [scheduleEditing, setScheduleEditing] = useState<Schedule | null | 'new'>(null);
  const [localError, setLocalError] = useState('');
  const selectedDate = new Date(selected + 'T12:00:00Z');
  const monday = new Date(selectedDate);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const days = Array.from({ length: view === 'day' ? 1 : 7 }, (_, i) => {
    const day = view === 'day' ? new Date(selectedDate) : new Date(monday);
    day.setUTCDate(day.getUTCDate() + (view === 'day' ? 0 : i));
    return day;
  });
  const allEvents = expandSchedules(data.events, data.schedules, data.subjects, selectedDate);
  const visibleEvents = allEvents.filter((e) =>
    days.some((d) => dayKey(d) === dayKey(new Date(e.start_at))),
  );
  const conflicts = new Set<string>();
  for (const a of visibleEvents)
    for (const b of visibleEvents)
      if (
        a.id !== b.id &&
        new Date(a.start_at) < new Date(b.end_at) &&
        new Date(b.start_at) < new Date(a.end_at)
      ) {
        conflicts.add(a.id);
        conflicts.add(b.id);
      }
  const move = (direction: number) => {
    const day = new Date(selectedDate);
    day.setUTCDate(day.getUTCDate() + direction * (view === 'day' ? 1 : 7));
    setSelected(dayKey(day));
  };
  const openEvent = (event: Event) => {
    if (event.id.startsWith('schedule:')) {
      const schedule = data.schedules.find((s) => s.id === event.id.split(':')[1]);
      if (schedule) setScheduleEditing(schedule);
    } else setEditing(event);
  };
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLocalError('');
    const fields = new FormData(e.currentTarget);
    const value = {
      title: String(fields.get('title')),
      subject_id: fields.get('subject_id') || null,
      start_at: warsawInstant(String(fields.get('date')), String(fields.get('start'))),
      end_at: warsawInstant(String(fields.get('date')), String(fields.get('end'))),
      location: fields.get('location') || '',
      document_id: editing && editing !== 'new' ? editing.document_id : null,
    };
    if (new Date(value.end_at) <= new Date(value.start_at)) {
      setLocalError('Godzina zakończenia musi być późniejsza niż rozpoczęcia.');
      return;
    }
    try {
      await mutate(
        editing && editing !== 'new' ? `/events/${editing.id}` : '/events',
        editing && editing !== 'new' ? 'PATCH' : 'POST',
        value,
      );
      setEditing(null);
      notify('Wydarzenie zapisane.');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Błąd zapisu.');
    }
  };
  const saveSchedule = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLocalError('');
    const f = new FormData(e.currentTarget);
    const value = {
      subject_id: f.get('subject_id'),
      weekday: Number(f.get('weekday')),
      start_time: f.get('start_time'),
      end_time: f.get('end_time'),
      valid_from: f.get('valid_from'),
      valid_to: f.get('valid_to'),
      location: f.get('location') || '',
    };
    try {
      await mutate(
        scheduleEditing && scheduleEditing !== 'new'
          ? `/schedules/${scheduleEditing.id}`
          : '/schedules',
        scheduleEditing && scheduleEditing !== 'new' ? 'PATCH' : 'POST',
        value,
      );
      setScheduleEditing(null);
      notify('Plan zajęć zapisany.');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Błąd zapisu.');
    }
  };
  return (
    <>
      <SectionTitle
        eyebrow="ZNAJDŹ SWÓJ RYTM"
        title="Kalendarz"
        description="Zajęcia, terminy i przestrzeń na naukę."
        action={
          <div className="heading-actions">
            <a className="button secondary" href="/api/export.ics" download>
              <ArrowDownToLine size={16} />
              <span>ICS</span>
            </a>
            <Button
              kind="secondary"
              onClick={() => {
                setLocalError('');
                setScheduleEditing('new');
                setEditing(null);
              }}
            >
              <BookOpen size={16} />
              Plan zajęć
            </Button>
            <Button
              onClick={() => {
                setLocalError('');
                setEditing('new');
                setScheduleEditing(null);
              }}
            >
              <Plus size={16} />
              Wydarzenie
            </Button>
          </div>
        }
      />
      {editing && (
        <section className="panel editor-panel">
          <div className="panel-heading">
            <h2>{editing === 'new' ? 'Nowe wydarzenie' : 'Edytuj wydarzenie'}</h2>
            <button className="icon-button" aria-label="Zamknij" onClick={() => setEditing(null)}>
              <X size={18} />
            </button>
          </div>
          <form onSubmit={save}>
            <div className="form-grid">
              <Field label="Nazwa wydarzenia">
                <input
                  name="title"
                  required
                  autoFocus
                  defaultValue={editing === 'new' ? '' : editing.title}
                />
              </Field>
              <Field label="Przedmiot">
                <select
                  name="subject_id"
                  defaultValue={editing === 'new' ? '' : (editing.subject_id ?? '')}
                >
                  <option value="">Ogólne</option>
                  {data.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Data">
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={editing === 'new' ? selected : dayKey(new Date(editing.start_at))}
                />
              </Field>
              <Field label="Miejsce">
                <input name="location" defaultValue={editing === 'new' ? '' : editing.location} />
              </Field>
              <Field label="Początek (Warszawa)">
                <input
                  name="start"
                  type="time"
                  required
                  defaultValue={editing === 'new' ? '10:00' : timeText(editing.start_at)}
                />
              </Field>
              <Field label="Koniec (Warszawa)">
                <input
                  name="end"
                  type="time"
                  required
                  defaultValue={editing === 'new' ? '11:30' : timeText(editing.end_at)}
                />
              </Field>
            </div>
            {localError && <div className="alert error">{localError}</div>}
            <div className="form-actions">
              {editing !== 'new' && (
                <Button
                  kind="danger"
                  onClick={() => {
                    void remove(`/events/${editing.id}`, 'Usunąć wydarzenie?').then(() =>
                      setEditing(null),
                    );
                  }}
                >
                  <Trash2 size={16} />
                  Usuń
                </Button>
              )}
              <Button kind="ghost" onClick={() => setEditing(null)}>
                Anuluj
              </Button>
              <Button type="submit" disabled={busy}>
                Zapisz wydarzenie
              </Button>
            </div>
          </form>
        </section>
      )}
      {scheduleEditing && (
        <section className="panel editor-panel">
          <div className="panel-heading">
            <h2>Powtarzalne zajęcia</h2>
            <button
              className="icon-button"
              aria-label="Zamknij"
              onClick={() => setScheduleEditing(null)}
            >
              <X size={18} />
            </button>
          </div>
          {!data.subjects.length ? (
            <p className="inline-note">Najpierw dodaj przedmiot w zakładce Przedmioty.</p>
          ) : (
            <form onSubmit={saveSchedule}>
              <div className="form-grid">
                <Field label="Przedmiot">
                  <select
                    name="subject_id"
                    required
                    defaultValue={scheduleEditing === 'new' ? '' : scheduleEditing.subject_id}
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
                <Field label="Dzień tygodnia">
                  <select
                    name="weekday"
                    defaultValue={scheduleEditing === 'new' ? 1 : scheduleEditing.weekday}
                  >
                    {[
                      'Poniedziałek',
                      'Wtorek',
                      'Środa',
                      'Czwartek',
                      'Piątek',
                      'Sobota',
                      'Niedziela',
                    ].map((d, i) => (
                      <option value={i + 1} key={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Początek">
                  <input
                    name="start_time"
                    type="time"
                    required
                    defaultValue={scheduleEditing === 'new' ? '09:00' : scheduleEditing.start_time}
                  />
                </Field>
                <Field label="Koniec">
                  <input
                    name="end_time"
                    type="time"
                    required
                    defaultValue={scheduleEditing === 'new' ? '10:30' : scheduleEditing.end_time}
                  />
                </Field>
                <Field label="Obowiązuje od">
                  <input
                    name="valid_from"
                    type="date"
                    required
                    defaultValue={scheduleEditing === 'new' ? selected : scheduleEditing.valid_from}
                  />
                </Field>
                <Field label="Obowiązuje do">
                  <input
                    name="valid_to"
                    type="date"
                    required
                    defaultValue={
                      scheduleEditing === 'new'
                        ? `${Number(data.preferences.academic_year.slice(5))}-06-30`
                        : scheduleEditing.valid_to
                    }
                  />
                </Field>
                <Field label="Sala / miejsce">
                  <input
                    name="location"
                    defaultValue={scheduleEditing === 'new' ? '' : scheduleEditing.location}
                  />
                </Field>
              </div>
              {localError && <div className="alert error">{localError}</div>}
              <div className="form-actions">
                {scheduleEditing !== 'new' && (
                  <Button
                    kind="danger"
                    onClick={() => {
                      void remove(
                        `/schedules/${scheduleEditing.id}`,
                        'Usunąć powtarzalne zajęcia?',
                      ).then(() => setScheduleEditing(null));
                    }}
                  >
                    <Trash2 size={16} />
                    Usuń
                  </Button>
                )}
                <Button kind="ghost" onClick={() => setScheduleEditing(null)}>
                  Anuluj
                </Button>
                <Button type="submit" disabled={busy}>
                  Zapisz plan zajęć
                </Button>
              </div>
            </form>
          )}
        </section>
      )}
      <div className="calendar-toolbar">
        <div className="date-navigation">
          <button className="icon-button" aria-label="Poprzedni okres" onClick={() => move(-1)}>
            <ArrowLeft size={18} />
          </button>
          <button className="icon-button" aria-label="Następny okres" onClick={() => move(1)}>
            <ArrowRight size={18} />
          </button>
          <h2>
            {new Intl.DateTimeFormat('pl-PL', {
              month: 'long',
              year: 'numeric',
              timeZone: 'Europe/Warsaw',
            }).format(selectedDate)}
          </h2>
          <Button kind="secondary" onClick={() => setSelected(dayKey(new Date()))}>
            Dzisiaj
          </Button>
        </div>
        <div className="tabs">
          <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>
            Dzień
          </button>
          <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>
            Tydzień
          </button>
        </div>
      </div>
      <div className={`calendar-grid ${view}`}>
        {days.map((day) => {
          const key = dayKey(day);
          const items = allEvents
            .filter((e) => dayKey(new Date(e.start_at)) === key)
            .sort((a, b) => a.start_at.localeCompare(b.start_at));
          const deadlines = data.tasks.filter((t) => t.due_date === key && t.status !== 'done');
          return (
            <section
              className={`calendar-day ${key === dayKey(new Date()) ? 'is-today' : ''}`}
              key={key}
            >
              <header>
                <span>
                  {new Intl.DateTimeFormat('pl-PL', {
                    weekday: 'short',
                    timeZone: 'Europe/Warsaw',
                  }).format(day)}
                </span>
                <strong>{day.getUTCDate()}</strong>
                <button
                  className="icon-button"
                  aria-label={`Dodaj wydarzenie ${dateText(key)}`}
                  onClick={() => {
                    setSelected(key);
                    setEditing('new');
                  }}
                >
                  <Plus size={14} />
                </button>
              </header>
              <div className="calendar-day-items">
                {items.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => openEvent(event)}
                    className={`calendar-event ${new Date(event.start_at) <= new Date() && new Date(event.end_at) > new Date() ? 'current' : ''}`}
                    style={{ borderLeftColor: subject(event.subject_id)?.color ?? COLORS[0] }}
                  >
                    <span className="event-time">
                      {timeText(event.start_at)} – {timeText(event.end_at)}
                    </span>
                    <strong>{event.title}</strong>
                    {event.location && <span>{event.location}</span>}
                    {conflicts.has(event.id) && (
                      <span className="conflict-label">
                        <AlertTriangle size={11} />
                        Konflikt
                      </span>
                    )}
                  </button>
                ))}
                {deadlines.map((task) => (
                  <div className="calendar-deadline" key={task.id}>
                    <ListTodo size={13} />
                    <div>
                      <span>Termin zadania</span>
                      <strong>{task.title}</strong>
                    </div>
                  </div>
                ))}
                {!items.length && !deadlines.length && (
                  <p className="day-empty">Wolna przestrzeń</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <p className="calendar-help">
        <Clock3 size={14} />
        Godziny w strefie Europe/Warsaw. Kliknij wydarzenie lub powtarzalne zajęcia, aby je
        edytować.
      </p>
    </>
  );
}
function Documents({
  data,
  mutate,
  remove,
  busy,
  notify,
  navigate,
}: SharedProps & { navigate: (page: Page) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [year, setYear] = useState(data.preferences.academic_year);
  const [progress, setProgress] = useState('');
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setLocalError('');
    try {
      setProgress('Sprawdzam dokument…');
      const { parsePdf } = await import('./pdf');
      const parsed = await parsePdf(file, (current, total) =>
        setProgress(`Odczytuję tekst: strona ${current} z ${total}`),
      );
      setProgress('Zapisuję tekst i tworzę analizę…');
      const result = (await mutate('/documents', 'POST', {
        name: file.name,
        hash: parsed.hash,
        pages: parsed.pages,
        subject_id: selectedSubject || null,
        academic_year: year,
      })) as { document: Document; cached: boolean };
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setProgress('Tworzę zapisany workflow analizy…');
      try {
        const analysis = (await mutate(`/documents/${result.document.id}/analyze`, 'POST')) as {
          run: Run;
          cached?: boolean;
        };
        sessionStorage.setItem('studentos-selected-run', analysis.run.id);
        notify(
          analysis.cached
            ? 'Otwieram zapisaną analizę dokumentu.'
            : 'Tekst zapisany. Workflow gotowy do uruchomienia agentów.',
        );
        navigate('activity');
      } catch (error) {
        setLocalError(
          `Tekst dokumentu został bezpiecznie zapisany. Nie udało się utworzyć analizy: ${error instanceof Error ? error.message : 'Spróbuj ponownie później.'} Możesz wrócić do niej przyciskiem „Analizuj” na liście materiałów poniżej.`,
        );
        notify('Dokument zapisany. Analiza wymaga ponowienia.');
      }
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Nie udało się odczytać dokumentu.');
    } finally {
      setUploading(false);
      setProgress('');
    }
  };
  return (
    <>
      <SectionTitle
        eyebrow="ŹRÓDŁA TWOJEJ WIEDZY"
        title="Dokumenty"
        description="Od sylabusa do sprawdzonej listy obowiązków."
      />
      <section className="panel upload-panel">
        <div className="upload-heading">
          <div className="upload-icon">
            <Upload size={22} />
          </div>
          <div>
            <h2>Dodaj dokument PDF</h2>
            <p>Tekst odczytujemy na Twoim urządzeniu. Oryginalny plik pozostaje u Ciebie.</p>
          </div>
        </div>
        <label
          className={`drop-zone ${file ? 'has-file' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const next = e.dataTransfer.files[0];
            if (next) setFile(next);
          }}
        >
          <input
            ref={fileRef}
            aria-label="Wybierz dokument PDF"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setLocalError('');
            }}
            disabled={uploading}
          />
          <FileText size={28} />
          <strong>{file?.name ?? 'Wybierz PDF lub upuść go tutaj'}</strong>
          <span>
            {file
              ? `${(file.size / 1024 / 1024).toFixed(2)} MB · gotowy do odczytu`
              : 'Do 10 MB, 100 stron i 120 000 znaków · PDF z warstwą tekstową'}
          </span>
        </label>
        <div className="upload-options">
          <Field label="Przedmiot">
            <select value={selectedSubject} onChange={(e) => setSelectedSubject(e.target.value)}>
              <option value="">Bez przypisania</option>
              {data.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rok akademicki">
            <input
              pattern="[0-9]{4}/[0-9]{4}"
              aria-label="Rok akademicki dokumentu"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2026/2027"
            />
          </Field>
          <Button
            disabled={!file || uploading || busy || !/^\d{4}\/\d{4}$/.test(year)}
            onClick={() => void upload()}
          >
            {uploading ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}
            Odczytaj i analizuj
          </Button>
        </div>
        {progress && (
          <p className="upload-progress" role="status">
            <LoaderCircle size={15} className="spin" />
            {progress}
          </p>
        )}
        {localError && (
          <div className="alert error" role="alert">
            {localError}
          </div>
        )}
        <div className="privacy-note">
          <ShieldCheck size={15} />
          <span>
            W chmurze zapisujemy tekst ze stron, metadane i wyniki analizy. Pełny PDF nie będzie
            dostępny na innym urządzeniu. Skany wymagają zewnętrznego OCR. Dane trafiają do
            Cloudflare Workers AI dopiero w trakcie analizy.
          </span>
        </div>
      </section>
      <div className="list-heading">
        <h2>
          Twoje materiały <span>{data.documents.length}</span>
        </h2>
      </div>
      <section className="panel">
        {data.documents.length ? (
          <div className="document-list">
            {data.documents.map((document) => {
              const run = data.runs.find((r) => r.document_id === document.id);
              return (
                <article className="document-row" key={document.id}>
                  <div className="file-icon">
                    <FileText size={21} />
                    <span>PDF</span>
                  </div>
                  <div className="document-info">
                    <h3>
                      {document.name ?? document.filename ?? document.title ?? 'Dokument PDF'}
                    </h3>
                    <p>
                      {document.page_count ?? '—'} stron <span>·</span>{' '}
                      {dateText(document.created_at)} <span>·</span>{' '}
                      {data.subjects.find((s) => s.id === document.subject_id)?.name ??
                        'Bez przedmiotu'}
                    </p>
                  </div>
                  <div className="document-actions">
                    {run && (
                      <Badge tone={run.state === 'failed' ? 'red' : 'lavender'}>
                        {stateLabel(run.state)}
                      </Badge>
                    )}
                    <Button
                      kind="secondary"
                      disabled={busy}
                      onClick={() => {
                        if (run) {
                          sessionStorage.setItem('studentos-selected-run', run.id);
                          navigate('activity');
                        } else
                          void mutate(`/documents/${document.id}/analyze`, 'POST')
                            .then((result) => {
                              const value = result as { run: Run };
                              sessionStorage.setItem('studentos-selected-run', value.run.id);
                              navigate('activity');
                            })
                            .catch(() => undefined);
                      }}
                    >
                      {run ? 'Otwórz analizę' : 'Analizuj'}
                      <ArrowUpRight size={14} />
                    </Button>
                    {run && (
                      <button
                        className="icon-button"
                        aria-label="Ponów analizę dokumentu"
                        title="Ponów analizę"
                        disabled={busy}
                        onClick={() => {
                          void mutate(`/documents/${document.id}/analyze`, 'POST')
                            .then((result) => {
                              const value = result as { run: Run };
                              sessionStorage.setItem('studentos-selected-run', value.run.id);
                              navigate('activity');
                            })
                            .catch(() => undefined);
                        }}
                      >
                        <Workflow size={16} />
                      </button>
                    )}
                    <button
                      className="icon-button danger-text"
                      title="Usuń dokument"
                      aria-label={`Usuń dokument ${document.name ?? ''}`}
                      onClick={() => {
                        void remove(
                          `/documents/${document.id}`,
                          'Usunąć dokument i wyniki jego analiz? Zatwierdzone zadania mogą pozostać bez źródła.',
                        );
                      }}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty icon={FileText} title="Pierwszy materiał czeka na odkrycie">
            Prześlij sylabus lub opis projektu. Każda propozycja zachowa odniesienie do strony
            dokumentu.
          </Empty>
        )}
      </section>
    </>
  );
}
const AGENT_STAGES = [
  { id: 'document', name: 'DocumentAgent', description: 'Struktura dokumentu i źródła' },
  { id: 'deadline', name: 'DeadlineAgent', description: 'Obowiązki i terminy' },
  { id: 'planner', name: 'PlannerAgent', description: 'Propozycja bloków nauki' },
  { id: 'review', name: 'ReviewAgent', description: 'Walidacja, duplikaty i konflikty' },
];
function Activity({ data, mutate, busy, notify, refresh }: SharedProps) {
  const [selected, setSelected] = useState(
    () => sessionStorage.getItem('studentos-selected-run') ?? data.runs[0]?.id ?? '',
  );
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [proposals, setProposals] = useState<ProposedTask[]>([]);
  const [blocks, setBlocks] = useState<StudyBlock[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [chosenBlocks, setChosenBlocks] = useState<Set<string>>(new Set());
  const [rawStep, setRawStep] = useState<number | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const apply = useCallback((result: RunDetail) => {
    setDetail(result);
    if (result.result) {
      setProposals(result.result.proposals);
      setBlocks(result.result.blocks);
      setChosen(
        new Set(
          result.result.proposals
            .filter((p) => !p.duplicate_of && !result.result?.review.rejected_ids.includes(p.id))
            .map((p) => p.id),
        ),
      );
      setChosenBlocks(new Set(result.result.blocks.map((b) => b.id)));
    }
  }, []);
  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    setDetail(null);
    setRunning(false);
    setAdvancing(false);
    setError('');
    sessionStorage.setItem('studentos-selected-run', selected);
    void api<RunDetail>(`/runs/${selected}`)
      .then((result) => {
        if (selectedRef.current === selected) apply(result);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Nie udało się odczytać analizy.'))
      .finally(() => setLoading(false));
  }, [selected, apply]);
  useEffect(() => {
    if (!running || !detail || advancing) return;
    if (['approval', 'committed', 'failed'].includes(detail.run.state)) {
      setRunning(false);
      void refresh();
      return;
    }
    let cancelled = false;
    setAdvancing(true);
    void api<RunDetail>(`/runs/${detail.run.id}/advance`, { method: 'POST' })
      .then((result) => {
        if (!cancelled && selectedRef.current === result.run.id) {
          apply(result);
          setAdvancing(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Etap nie powiódł się.');
          setRunning(false);
          setAdvancing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [running, detail, apply]);
  const approve = async () => {
    try {
      const accepted = proposals.filter((p) => chosen.has(p.id));
      await mutate(`/runs/${selected}/approve`, 'POST', {
        proposals: accepted,
        blocks: blocks.filter((b) => chosenBlocks.has(b.id) && chosen.has(b.proposal_id)),
      });
      setRunning(false);
      const result = await api<RunDetail>(`/runs/${selected}`);
      apply(result);
      notify('Zatwierdzone zadania i bloki nauki zapisano.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zatwierdzić wyników.');
    }
  };
  const run = detail?.run;
  const stageIndex = AGENT_STAGES.findIndex((s) => s.id === run?.state);
  const toggle = (set: Set<string>, id: string, update: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  return (
    <>
      <SectionTitle
        eyebrow="WIDOCZNY PROCES. SPRAWDZALNE REZULTATY."
        title="Aktywność agentów"
        description="Zobacz, jak dokument zmienia się w plan. Każdy etap ma swój ślad."
        action={
          <Badge tone="green">
            <span className="status-dot" />
            Rzeczywiste logi wykonań
          </Badge>
        }
      />
      {!data.runs.length ? (
        <section className="panel">
          <Empty icon={Workflow} title="Twój zespół czeka na materiał">
            Dodaj tekstowy PDF w zakładce Dokumenty, aby uruchomić pierwszy workflow. Historia
            pojawi się dopiero po wykonaniu rzeczywistych operacji.
          </Empty>
        </section>
      ) : (
        <div className="activity-layout">
          <aside className="panel run-list">
            <div className="panel-heading">
              <h2>Uruchomienia</h2>
              <Badge>{data.runs.length}</Badge>
            </div>
            {data.runs.map((item) => (
              <button
                key={item.id}
                className={selected === item.id ? 'selected' : ''}
                onClick={() => setSelected(item.id)}
              >
                <span className={`run-state-dot ${item.state}`} />
                <div>
                  <strong>
                    {data.documents.find((d) => d.id === item.document_id)?.name ??
                      'Analiza dokumentu'}
                  </strong>
                  <span>
                    {dateText(item.created_at)} ·{' '}
                    {stateLabel(selected === item.id && run ? run.state : item.state)}
                  </span>
                </div>
                <ChevronRight size={15} />
              </button>
            ))}
          </aside>
          <div className="activity-detail">
            {loading && (
              <section className="panel loading-panel">
                <LoaderCircle size={22} className="spin" />
                Odczytuję zapisany przebieg…
              </section>
            )}
            {error && (
              <div className="alert error" role="alert">
                <AlertTriangle size={17} />
                {error}
              </div>
            )}
            {run && (
              <>
                <section className="panel workflow-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Przebieg analizy</h2>
                      <p className="run-id">ID {run.id}</p>
                    </div>
                    <Badge
                      tone={
                        run.state === 'failed'
                          ? 'red'
                          : run.state === 'committed'
                            ? 'green'
                            : 'lavender'
                      }
                    >
                      {stateLabel(run.state)}
                    </Badge>
                  </div>
                  <div className="workflow-stages">
                    {AGENT_STAGES.map((stage, index) => {
                      const completed =
                        ['approval', 'committed'].includes(run.state) || index < stageIndex;
                      const active = run.state === stage.id;
                      return (
                        <div
                          key={stage.id}
                          className={`workflow-stage ${completed ? 'complete' : ''} ${active ? 'active' : ''}`}
                        >
                          <div className="stage-number">
                            {completed ? (
                              <Check size={15} />
                            ) : active && advancing ? (
                              <LoaderCircle className="spin" size={15} />
                            ) : (
                              index + 1
                            )}
                          </div>
                          <div>
                            <strong>{stage.name}</strong>
                            <span>{stage.description}</span>
                          </div>
                          {index < 3 && <ChevronRight className="stage-arrow" size={16} />}
                        </div>
                      );
                    })}
                  </div>
                  <div className="workflow-action">
                    <div>
                      <ShieldCheck size={16} />
                      <p>
                        {run.state === 'approval'
                          ? 'Analiza zakończona. Przejrzyj propozycje przed zapisem.'
                          : run.state === 'committed'
                            ? 'Zatwierdzone dane są już dostępne w zadaniach i kalendarzu.'
                            : run.state === 'failed'
                              ? 'Analiza została zatrzymana. Zapisane dane i wcześniejsze etapy pozostają dostępne.'
                              : 'Każde żądanie wykonuje jeden etap. Postęp jest zapisywany w D1.'}
                      </p>
                    </div>
                    {!['approval', 'committed', 'failed'].includes(run.state) && (
                      <Button
                        disabled={busy || advancing}
                        onClick={() => {
                          setError('');
                          setRunning(!running);
                        }}
                      >
                        {advancing ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <Workflow size={16} />
                        )}{' '}
                        {running ? 'Etap trwa…' : 'Kontynuuj analizę'}
                      </Button>
                    )}
                  </div>
                  {running && (
                    <p className="runtime-note" role="status">
                      Pozostaw ten widok otwarty. Po odświeżeniu możesz bezpiecznie wznowić od
                      zapisanego etapu.
                    </p>
                  )}
                  {run.error && <div className="alert error">{run.error}</div>}
                  <div className="run-metadata">
                    <span>
                      Model: <code>{run.model ?? 'zapisany w szczegółach etapów'}</code>
                    </span>
                    <span>
                      Utworzono: {dateText(run.created_at)} {timeText(run.created_at)}
                    </span>
                  </div>
                </section>
                {run.state === 'approval' && detail?.result && (
                  <section className="panel approval-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Twoja decyzja</h2>
                        <p className="page-description">
                          Popraw terminy, wybierz zadania i bloki nauki. Zapis nastąpi dopiero po
                          zatwierdzeniu.
                        </p>
                      </div>
                      <Badge tone="lavender">{proposals.length} propozycji</Badge>
                    </div>
                    {detail.result.review.summary && (
                      <div className="review-summary">
                        <ShieldCheck size={18} />
                        <p>{detail.result.review.summary}</p>
                      </div>
                    )}
                    {detail.result.review.issues.map((issue, index) => (
                      <div key={index} className={`review-issue ${issue.severity}`}>
                        <AlertTriangle size={15} />
                        <span>{issue.message}</span>
                      </div>
                    ))}
                    {proposals.length ? (
                      proposals.map((proposal) => (
                        <article
                          key={proposal.id}
                          className={`proposal ${chosen.has(proposal.id) ? 'selected' : ''}`}
                        >
                          <label className="proposal-select">
                            <input
                              type="checkbox"
                              checked={chosen.has(proposal.id)}
                              onChange={() => toggle(chosen, proposal.id, setChosen)}
                            />
                            <span>Uwzględnij zadanie</span>
                            <Badge tone={proposal.requires_confirmation ? 'peach' : 'green'}>
                              {proposal.requires_confirmation
                                ? 'Wymaga potwierdzenia'
                                : `${Math.round(proposal.confidence * 100)}% pewności modelu`}
                            </Badge>
                          </label>
                          <div className="proposal-fields">
                            <Field label="Tytuł zadania">
                              <input
                                value={proposal.title}
                                maxLength={240}
                                onChange={(e) =>
                                  setProposals(
                                    proposals.map((p) =>
                                      p.id === proposal.id ? { ...p, title: e.target.value } : p,
                                    ),
                                  )
                                }
                              />
                            </Field>
                            <Field label="Termin">
                              <input
                                type="date"
                                value={proposal.due_date ?? ''}
                                onChange={(e) =>
                                  setProposals(
                                    proposals.map((p) =>
                                      p.id === proposal.id
                                        ? {
                                            ...p,
                                            due_date: e.target.value || null,
                                          }
                                        : p,
                                    ),
                                  )
                                }
                              />
                            </Field>
                            <Field label="Priorytet">
                              <select
                                value={proposal.priority}
                                onChange={(e) =>
                                  setProposals(
                                    proposals.map((p) =>
                                      p.id === proposal.id
                                        ? {
                                            ...p,
                                            priority: e.target.value as ProposedTask['priority'],
                                          }
                                        : p,
                                    ),
                                  )
                                }
                              >
                                {['low', 'medium', 'high'].map((priority) => (
                                  <option key={priority} value={priority}>
                                    {priorityLabel(priority)}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </div>
                          {(detail.result?.proposals.find((original) => original.id === proposal.id)
                            ?.requires_confirmation ||
                            proposal.requires_confirmation) && (
                            <label className="confirm-proposal">
                              <input
                                type="checkbox"
                                checked={!proposal.requires_confirmation}
                                onChange={(e) =>
                                  setProposals(
                                    proposals.map((p) =>
                                      p.id === proposal.id
                                        ? { ...p, requires_confirmation: !e.target.checked }
                                        : p,
                                    ),
                                  )
                                }
                              />
                              <span>
                                Potwierdzam poprawność danych, także jeśli termin pozostaje
                                niepełny.
                              </span>
                            </label>
                          )}
                          {proposal.duplicate_of && (
                            <p className="warning-text">
                              Możliwy duplikat istniejącego zadania. Sprawdź przed zatwierdzeniem.
                            </p>
                          )}
                          {proposal.sources.map((source, index) => (
                            <blockquote key={index}>
                              <span>
                                <FileText size={13} />
                                Strona {source.page}
                              </span>
                              „{source.quote}”
                            </blockquote>
                          ))}
                          {proposal.estimated_minutes && (
                            <p className="estimate-note">
                              Szacowany czas: {proposal.estimated_minutes} min. To propozycja, nie
                              potwierdzona wartość.
                            </p>
                          )}
                        </article>
                      ))
                    ) : (
                      <div className="quiet-empty">
                        <CheckCheck size={20} />
                        <p>Nie wykryto obowiązków wymagających zapisania.</p>
                      </div>
                    )}
                    {blocks.length > 0 && (
                      <div className="study-blocks">
                        <h3>
                          Proponowane bloki nauki <span>· szacunki</span>
                        </h3>
                        {blocks.map((block) => (
                          <div className="study-block" key={block.id}>
                            <input
                              aria-label={`Zapisz blok ${block.title}`}
                              type="checkbox"
                              checked={chosenBlocks.has(block.id) && chosen.has(block.proposal_id)}
                              disabled={!chosen.has(block.proposal_id)}
                              onChange={() => toggle(chosenBlocks, block.id, setChosenBlocks)}
                            />
                            <div>
                              <Field label="Nazwa bloku">
                                <input
                                  value={block.title}
                                  onChange={(e) =>
                                    setBlocks(
                                      blocks.map((b) =>
                                        b.id === block.id ? { ...b, title: e.target.value } : b,
                                      ),
                                    )
                                  }
                                />
                              </Field>
                              <div className="form-grid">
                                <Field label="Początek (Warszawa)">
                                  <input
                                    type="datetime-local"
                                    value={datetimeInput(block.start_at)}
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        const [d, t] = e.target.value.split('T');
                                        setBlocks(
                                          blocks.map((b) =>
                                            b.id === block.id
                                              ? { ...b, start_at: warsawInstant(d, t) }
                                              : b,
                                          ),
                                        );
                                      }
                                    }}
                                  />
                                </Field>
                                <Field label="Koniec (Warszawa)">
                                  <input
                                    type="datetime-local"
                                    value={datetimeInput(block.end_at)}
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        const [d, t] = e.target.value.split('T');
                                        setBlocks(
                                          blocks.map((b) =>
                                            b.id === block.id
                                              ? { ...b, end_at: warsawInstant(d, t) }
                                              : b,
                                          ),
                                        );
                                      }
                                    }}
                                  />
                                </Field>
                              </div>
                              <p>{block.reason}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="approval-footer">
                      <span>
                        Wybrano {chosen.size} zadań ·{' '}
                        {
                          blocks.filter((b) => chosenBlocks.has(b.id) && chosen.has(b.proposal_id))
                            .length
                        }{' '}
                        bloków nauki
                      </span>
                      <Button disabled={busy} onClick={() => void approve()}>
                        {busy ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <CheckCheck size={16} />
                        )}
                        Zatwierdź i zapisz
                      </Button>
                    </div>
                  </section>
                )}
                <section className="panel steps-panel">
                  <div className="panel-heading">
                    <h2>Dziennik wykonania</h2>
                    <Badge>{detail?.steps.length ?? 0} etapów</Badge>
                  </div>
                  {detail?.steps.length ? (
                    detail.steps.map((step, index) => (
                      <div key={String(step.id ?? index)} className="log-step">
                        <button
                          onClick={() => setRawStep(rawStep === index ? null : index)}
                          className="log-step-summary"
                        >
                          <span className={`log-status ${step.state === 'failed' ? 'failed' : ''}`}>
                            {step.state === 'failed' ? (
                              <AlertTriangle size={16} />
                            ) : step.state === 'running' ? (
                              <LoaderCircle size={16} className="spin" />
                            ) : (
                              <Check size={16} />
                            )}
                          </span>
                          <div>
                            <strong>
                              {String(
                                step.agent ?? step.agent_name ?? step.name ?? 'Etap workflow',
                              )}
                            </strong>
                            <span>
                              {String(
                                step.output_summary ??
                                  step.summary ??
                                  stateLabel(String(step.state ?? 'completed')),
                              )}
                            </span>
                          </div>
                          <span className="log-duration">
                            {typeof step.duration_ms === 'number'
                              ? `${(step.duration_ms / 1000).toFixed(2)} s`
                              : ''}
                          </span>
                          <ChevronRight size={16} />
                        </button>
                        {rawStep === index && (
                          <div className="log-step-content">
                            <p>
                              Operacyjne metadane i ustrukturyzowany wynik. Bez ukrytego toku
                              rozumowania modelu.
                            </p>
                            <pre>{JSON.stringify(step, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="quiet-empty">
                      <Workflow size={20} />
                      <p>Nie wykonano jeszcze żadnego etapu modelu.</p>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      )}
      <div className="activity-footnote">
        <ShieldCheck size={15} />
        Metadane operacyjne nie zawierają ukrytych procesów rozumowania. Zużycie tokenów — jeśli
        dostępne — znajdziesz w szczegółach etapów; nie jest ono rachunkiem Cloudflare.
      </div>
    </>
  );
}

function Settings({ data, mutate, busy, notify }: SharedProps) {
  const [localError, setLocalError] = useState('');
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setLocalError('');
    try {
      await mutate('/preferences', 'PUT', {
        ...data.preferences,
        academic_year: f.get('academic_year'),
        available_from: f.get('available_from'),
        available_to: f.get('available_to'),
        study_days: f.getAll('study_days').map(Number),
        ai_enabled: f.get('ai_enabled') === 'on',
      });
      notify('Preferencje zapisane.');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Nie udało się zapisać ustawień.');
    }
  };
  return (
    <>
      <SectionTitle
        eyebrow="TWOJE WARUNKI"
        title="Ustawienia"
        description="Dopasuj planowanie do swojego rytmu dnia."
      />
      <div className="settings-grid">
        <section className="panel settings-panel">
          <div className="panel-heading">
            <h2>Nauka i dostępność</h2>
          </div>
          <form onSubmit={save}>
            <Field label="Rok akademicki">
              <input
                required
                name="academic_year"
                pattern="[0-9]{4}/[0-9]{4}"
                defaultValue={data.preferences.academic_year}
                placeholder="2026/2027"
              />
            </Field>
            <div className="form-grid">
              <Field label="Mogę uczyć się od">
                <input
                  name="available_from"
                  type="time"
                  required
                  defaultValue={data.preferences.available_from}
                />
              </Field>
              <Field label="Mogę uczyć się do">
                <input
                  name="available_to"
                  type="time"
                  required
                  defaultValue={data.preferences.available_to}
                />
              </Field>
            </div>
            <fieldset className="day-checkboxes">
              <legend>Dni dostępne na naukę</legend>
              {['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Niedz'].map((day, index) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    name="study_days"
                    value={index + 1}
                    defaultChecked={data.preferences.study_days.includes(index + 1)}
                  />
                  <span>{day}</span>
                </label>
              ))}
            </fieldset>
            <label className="toggle-label">
              <input
                name="ai_enabled"
                type="checkbox"
                defaultChecked={data.preferences.ai_enabled}
              />
              <span>
                <strong>Analiza z Workers AI</strong>
                <small>Wyłącz, aby wstrzymać nowe wywołania modeli.</small>
              </span>
            </label>
            {localError && <div className="alert error">{localError}</div>}
            <div className="form-actions">
              <Button type="submit" disabled={busy}>
                <Check size={16} />
                Zapisz preferencje
              </Button>
            </div>
          </form>
        </section>
        <div>
          <section className="panel settings-info">
            <h2>Twoje dane</h2>
            <p>
              Język: polski
              <br />
              Strefa czasowa: Europe/Warsaw
              <br />
              Daty: DD.MM.RRRR
            </p>
            <a className="button secondary" href="/api/export" download>
              <ArrowDownToLine size={16} />
              Eksportuj dane JSON
            </a>
            <a className="button secondary" href="/api/export.ics" download>
              <CalendarDays size={16} />
              Eksportuj kalendarz ICS
            </a>
            <p className="small-note">
              Eksport zawiera prywatne dane. Zapisz go w bezpiecznym miejscu. Zadania i dokumenty
              możesz usuwać na odpowiednich ekranach.
            </p>
          </section>
          <Usage />
          <section className="panel settings-info">
            <h2>Bezpłatna infrastruktura</h2>
            <p>
              Analizy mają limity dzienne, długości dokumentu i wywołań agentów. Po ich wyczerpaniu
              nadal możesz zarządzać zadaniami i kalendarzem.
            </p>
            <p className="small-note">
              Budżety aplikacji ograniczają użycie. Rzeczywiste wykorzystanie konta i limity
              dostawcy sprawdzisz w panelu Cloudflare. StudentOS nie włącza płatnego planu.
            </p>
            <a
              href="https://dash.cloudflare.com/"
              target="_blank"
              rel="noreferrer"
              className="text-button"
            >
              Panel Cloudflare <ExternalLink size={14} />
            </a>
          </section>
          <section className="panel settings-info">
            <h2>Zainstaluj na Androidzie</h2>
            <p>
              Otwórz StudentOS w Chrome. W menu ⋮ wybierz „Dodaj do ekranu głównego” lub „Zainstaluj
              aplikację”. Do synchronizacji i analiz AI potrzebujesz internetu.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

function taskMetadata(
  notes?: string,
): { sources: { page: number; quote: string }[]; user_notes?: string; warning?: string } | null {
  if (!notes) return null;
  try {
    const value: unknown = JSON.parse(notes);
    if (
      value &&
      typeof value === 'object' &&
      'sources' in value &&
      Array.isArray(value.sources) &&
      value.sources.every(
        (source) =>
          source &&
          typeof source === 'object' &&
          typeof source.page === 'number' &&
          typeof source.quote === 'string',
      )
    ) {
      const record = value as Record<string, unknown>;
      return {
        sources: value.sources as { page: number; quote: string }[],
        user_notes: typeof record.user_notes === 'string' ? record.user_notes : undefined,
        warning: typeof record.warning === 'string' ? record.warning : undefined,
      };
    }
  } catch {
    /* User notes may contain plain text. */
  }
  return null;
}

function Usage() {
  const [value, setValue] = useState<{
    usage: { analyses: number; calls: number; input_tokens: number; output_tokens: number };
    limits: { analyses: number; calls: number; max_calls_per_run: number };
    note: string;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<NonNullable<typeof value>>('/usage')
      .then(setValue)
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Nie udało się odczytać wykorzystania.'),
      );
  }, []);
  return (
    <section className="panel settings-info">
      <h2>Wykorzystanie AI dzisiaj</h2>
      {value ? (
        <>
          <div className="usage-grid">
            <div>
              <strong>
                {value.usage.analyses} / {value.limits.analyses}
              </strong>
              <span>utworzonych analiz</span>
            </div>
            <div>
              <strong>
                {value.usage.calls} / {value.limits.calls}
              </strong>
              <span>wywołań modeli</span>
            </div>
          </div>
          <p className="small-note">
            Limit na workflow: {value.limits.max_calls_per_run} wywołań. Tokeny zwrócone przez
            dostawcę: {value.usage.input_tokens} wejścia, {value.usage.output_tokens} wyjścia.
          </p>
          <p className="small-note">{value.note}</p>
        </>
      ) : error ? (
        <p className="small-note">{error}</p>
      ) : (
        <p className="small-note">Odczytuję liczniki aplikacji…</p>
      )}
    </section>
  );
}
