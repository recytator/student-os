import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, json } from '../api';
import { useFeedback } from '../components/ui';
import type { Bootstrap, Subject, Task } from './types';

export type Page =
  | 'today'
  | 'plan'
  | 'tasks'
  | 'materials'
  | 'doc'
  | 'subjects'
  | 'subject'
  | 'analysis'
  | 'settings';
export type Route = { page: Page; id?: string };
const ALIASES: Record<string, Page> = {
  '': 'today',
  dashboard: 'today',
  calendar: 'plan',
  documents: 'materials',
  activity: 'analysis',
};
const PAGES: Page[] = [
  'today',
  'plan',
  'tasks',
  'materials',
  'doc',
  'subjects',
  'subject',
  'analysis',
  'settings',
];
export function parseRoute(hash = location.hash): Route {
  const [raw = '', id] = hash.replace(/^#/, '').split('/');
  const page = ALIASES[raw] ?? (PAGES.includes(raw as Page) ? (raw as Page) : 'today');
  return id ? { page, id: decodeURIComponent(id) } : { page };
}
export const href = (route: Route) =>
  `#${route.page}${route.id ? `/${encodeURIComponent(route.id)}` : ''}`;

export type TaskDraft = Partial<
  Pick<Task, 'title' | 'subject_id' | 'due_date' | 'kind' | 'priority'>
>;
type Store = {
  data: Bootstrap;
  route: Route;
  go: (route: Route) => void;
  refresh: () => Promise<void>;
  /** Calls the API, then refreshes in the background. Errors become a toast and are rethrown. */
  call: <T = unknown>(
    path: string,
    method: string,
    body?: unknown,
    options?: { quiet?: boolean },
  ) => Promise<T>;
  patch: (update: (data: Bootstrap) => Bootstrap) => void;
  subject: (id?: string | null) => Subject | undefined;
  editTask: (task: Task | 'new', draft?: TaskDraft) => void;
  setTaskStatus: (task: Task, status: 'todo' | 'done') => void;
};
const StoreContext = createContext<Store | null>(null);
export const useStore = () => {
  const value = useContext(StoreContext);
  if (!value) throw new Error('StoreProvider missing');
  return value;
};

export function StoreProvider({
  initial,
  children,
  onEditTask,
}: {
  initial: Bootstrap;
  children: ReactNode;
  onEditTask: (task: Task | 'new', draft?: TaskDraft) => void;
}) {
  const [data, setData] = useState(initial);
  const [route, setRoute] = useState(parseRoute);
  const { toast } = useFeedback();
  const generation = useRef(0);
  useEffect(() => {
    const change = () => {
      setRoute(parseRoute());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const next = await api<Bootstrap>('/bootstrap');
    if (current === generation.current) setData(normalize(next));
  }, []);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [refresh]);
  const call = useCallback<Store['call']>(
    async (path, method, body, options) => {
      try {
        const result = await api<never>(path, {
          method,
          body: body === undefined ? undefined : json(body),
        });
        const warnings = (result as { warnings?: unknown } | null)?.warnings;
        if (Array.isArray(warnings) && warnings.length) toast(warnings.join(' '));
        void refresh().catch(() => undefined);
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) location.reload();
        if (!options?.quiet)
          toast(error instanceof Error ? error.message : 'Operacja nie powiodła się.', {
            tone: 'error',
          });
        void refresh().catch(() => undefined);
        throw error;
      }
    },
    [refresh, toast],
  );
  const patch = useCallback((update: (data: Bootstrap) => Bootstrap) => setData(update), []);
  const setTaskStatus = useCallback(
    (task: Task, status: 'todo' | 'done') => {
      setData((all) => ({
        ...all,
        tasks: all.tasks.map((item) => (item.id === task.id ? { ...item, status } : item)),
      }));
      void call(`/tasks/${task.id}`, 'PATCH', { status })
        .then(() => {
          if (status === 'done')
            toast(`Ukończono: ${task.title}`, {
              action: { label: 'Cofnij', run: () => setTaskStatus(task, 'todo') },
            });
        })
        .catch(() => undefined);
    },
    [call, toast],
  );
  const go = useCallback((next: Route) => {
    location.hash = href(next);
  }, []);
  const subject = useCallback(
    (id?: string | null) => (id ? data.subjects.find((item) => item.id === id) : undefined),
    [data.subjects],
  );
  return (
    <StoreContext.Provider
      value={{
        data,
        route,
        go,
        refresh,
        call,
        patch,
        subject,
        editTask: onEditTask,
        setTaskStatus,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function normalize(value: Bootstrap): Bootstrap {
  return {
    ...value,
    subtasks: value.subtasks ?? [],
    schedule_exceptions: value.schedule_exceptions ?? [],
    timetables: value.timetables ?? [],
    notes: value.notes ?? [],
    runs: value.runs ?? [],
    documents: value.documents ?? [],
    preferences: value.preferences ?? ({} as Bootstrap['preferences']),
  };
}
