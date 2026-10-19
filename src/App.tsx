import {
  BookOpen,
  CalendarDays,
  FileText,
  GraduationCap,
  LayoutGrid,
  ListTodo,
  LoaderCircle,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { CommandPalette } from './components/CommandPalette';
import { TaskEditor } from './components/tasks';
import { Button, FeedbackProvider } from './components/ui';
import { cn } from './lib/cn';
import { isDone } from './lib/schedule';
import { href, normalize, StoreProvider, useStore, type Page, type TaskDraft } from './lib/store';
import { todayKey } from './lib/time';
import type { Bootstrap, Task } from './lib/types';
import { DocumentPage } from './pages/DocumentPage';
import { Materials } from './pages/Materials';
import { Plan } from './pages/Plan';
import { AnalysisPage, logout, Settings } from './pages/Settings';
import { SubjectPage, Subjects } from './pages/Subjects';
import { Tasks } from './pages/Tasks';
import { Today } from './pages/Today';

const NAV: { page: Page; label: string; icon: LucideIcon; match: Page[] }[] = [
  { page: 'today', label: 'Dziś', icon: LayoutGrid, match: ['today'] },
  { page: 'plan', label: 'Plan', icon: CalendarDays, match: ['plan'] },
  { page: 'tasks', label: 'Zadania', icon: ListTodo, match: ['tasks'] },
  {
    page: 'materials',
    label: 'Materiały',
    icon: FileText,
    match: ['materials', 'doc', 'analysis'],
  },
  { page: 'subjects', label: 'Przedmioty', icon: BookOpen, match: ['subjects', 'subject'] },
];

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'login' | 'error'>('loading');
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setState('loading');
    api<Bootstrap>('/bootstrap')
      .then((value) => {
        setData(normalize(value));
        setState('ready');
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setState('login');
        else {
          setError(e instanceof Error ? e.message : 'Nie udało się pobrać danych.');
          setState('error');
        }
      });
  }, []);
  useEffect(load, [load]);
  if (state === 'loading')
    return (
      <div className="splash">
        <GraduationCap size={28} strokeWidth={1.6} />
        <LoaderCircle size={18} className="spin" />
      </div>
    );
  if (state === 'login') return <Login />;
  if (state === 'error' || !data)
    return (
      <div className="splash">
        <h1>Nie udało się otworzyć StudentOS</h1>
        <p className="muted">
          {error || (navigator.onLine ? '' : 'Brak połączenia z internetem.')}
        </p>
        <Button variant="primary" onClick={load}>
          Spróbuj ponownie
        </Button>
      </div>
    );
  return (
    <FeedbackProvider>
      <Shell initial={data} />
    </FeedbackProvider>
  );
}

function Login() {
  return (
    <div className="login">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">
            <GraduationCap size={18} />
          </span>
          StudentOS
        </div>
        <h1>Twoje studia w jednym miejscu.</h1>
        <p className="muted">
          Plan zajęć, zadania i terminy, a do tego notatki i fiszki z wykładów generowane przez AI.
        </p>
        <a className="btn btn-primary btn-block" href="/api/auth/login">
          Zaloguj przez GitHub
        </a>
        <p className="fine-print">
          Prywatna przestrzeń jednego konta. Bez dostępu do repozytoriów.
        </p>
      </div>
    </div>
  );
}

function Shell({ initial }: { initial: Bootstrap }) {
  const [editor, setEditor] = useState<{ task: Task | 'new'; draft?: TaskDraft } | null>(null);
  const editTask = useCallback(
    (task: Task | 'new', draft?: TaskDraft) => setEditor({ task, draft }),
    [],
  );
  return (
    <StoreProvider initial={initial} onEditTask={editTask}>
      <Layout />
      {editor && (
        <TaskEditor task={editor.task} draft={editor.draft} onClose={() => setEditor(null)} />
      )}
    </StoreProvider>
  );
}

function Layout() {
  const { data, route, editTask } = useStore();
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement).closest(
        'input,textarea,select,[contenteditable]',
      );
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
      } else if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === '/') {
          event.preventDefault();
          setPalette(true);
        } else if (event.key === 'n' && !document.querySelector('[role="dialog"]')) {
          event.preventDefault();
          editTask('new');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editTask]);
  useEffect(() => setMore(false), [route]);
  const today = todayKey();
  const overdue = data.tasks.filter(
    (task) => !isDone(task) && task.due_date && task.due_date <= today,
  ).length;
  const pendingReview = data.runs.filter((run) => run.state === 'approval').length;
  const name = data.user.name || data.user.github_login || 'Student';
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Przejdź do treści
      </a>
      <aside className="sidebar">
        <a className="brand" href={href({ page: 'today' })}>
          <span className="brand-mark">
            <GraduationCap size={17} />
          </span>
          StudentOS
        </a>
        <button className="search-trigger" onClick={() => setPalette(true)}>
          <Search size={15} />
          <span>Szukaj…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav aria-label="Nawigacja główna">
          {NAV.map((item) => (
            <a
              key={item.page}
              href={href({ page: item.page })}
              className={cn('nav-item', item.match.includes(route.page) && 'active')}
            >
              <item.icon size={17} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.page === 'tasks' && overdue > 0 && <span className="nav-badge">{overdue}</span>}
              {item.page === 'materials' && pendingReview > 0 && (
                <span className="nav-badge nav-badge-amber">{pendingReview}</span>
              )}
            </a>
          ))}
        </nav>
        <Button variant="primary" className="sidebar-cta" onClick={() => editTask('new')}>
          <Plus size={15} /> Nowe zadanie
        </Button>
        <div className="sidebar-foot">
          <a
            href={href({ page: 'settings' })}
            className={cn('nav-item', route.page === 'settings' && 'active')}
          >
            <Settings2 size={17} strokeWidth={1.8} />
            <span>Ustawienia</span>
          </a>
          <div className="user-chip">
            {data.user.avatar_url ? (
              <img src={data.user.avatar_url} alt="" width={26} height={26} />
            ) : (
              <span className="avatar">{name[0]}</span>
            )}
            <span className="grow">{name}</span>
            <button
              className="icon-btn icon-btn-sm"
              onClick={logout}
              aria-label="Wyloguj"
              title="Wyloguj"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
      <header className="mobile-top">
        <a className="brand" href={href({ page: 'today' })}>
          <span className="brand-mark">
            <GraduationCap size={16} />
          </span>
          StudentOS
        </a>
        <button className="icon-btn" aria-label="Szukaj" onClick={() => setPalette(true)}>
          <Search size={18} />
        </button>
        <button
          className="icon-btn icon-btn-accent"
          aria-label="Nowe zadanie"
          onClick={() => editTask('new')}
        >
          <Plus size={18} />
        </button>
      </header>
      <main id="main" className="main">
        {data.user.github_login === 'local' && (
          <div className="dev-banner">Tryb lokalny · sesja deweloperska</div>
        )}
        {route.page === 'today' && <Today />}
        {route.page === 'plan' && <Plan />}
        {route.page === 'tasks' && <Tasks />}
        {route.page === 'materials' && <Materials />}
        {route.page === 'doc' && route.id && <DocumentPage id={route.id} />}
        {route.page === 'subjects' && <Subjects />}
        {route.page === 'subject' && route.id && <SubjectPage id={route.id} />}
        {route.page === 'analysis' && <AnalysisPage id={route.id} />}
        {route.page === 'settings' && <Settings />}
      </main>
      <nav className="bottom-nav" aria-label="Nawigacja mobilna">
        {NAV.slice(0, 4).map((item) => (
          <a
            key={item.page}
            href={href({ page: item.page })}
            className={cn(item.match.includes(route.page) && 'active')}
          >
            <item.icon size={20} strokeWidth={1.8} />
            <span>{item.label}</span>
            {item.page === 'tasks' && overdue > 0 && <i className="dot" />}
          </a>
        ))}
        <button
          className={cn(
            (more || ['subjects', 'subject', 'settings'].includes(route.page)) && 'active',
          )}
          onClick={() => setMore(!more)}
          aria-expanded={more}
        >
          <MoreHorizontal size={20} />
          <span>Więcej</span>
        </button>
      </nav>
      {more && (
        <>
          <div className="sheet-backdrop" onClick={() => setMore(false)} />
          <div className="sheet" role="menu">
            <a href={href({ page: 'subjects' })} role="menuitem">
              <BookOpen size={18} /> Przedmioty
            </a>
            <a href={href({ page: 'settings' })} role="menuitem">
              <Settings2 size={18} /> Ustawienia
            </a>
            <button onClick={logout} role="menuitem">
              <LogOut size={18} /> Wyloguj
            </button>
          </div>
        </>
      )}
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </div>
  );
}
