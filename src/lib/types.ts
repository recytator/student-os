import type {
  Subject as SubjectRecord,
  Task as TaskRecord,
  CalendarEvent as EventRecord,
  ClassSchedule as ScheduleRecord,
  Preferences,
  ProposedTask,
  StudyBlock,
  ReviewAgentOutput,
  NotesPart,
  NotesDetail,
  TaskKind,
} from '../../shared/contracts';

export type { Preferences, ProposedTask, StudyBlock, ReviewAgentOutput, NotesPart, NotesDetail };
export type { TaskKind };
export type Subject = SubjectRecord;
export type Task = TaskRecord & { proposal_id?: string | null };
export type Subtask = {
  id: string;
  task_id: string;
  title: string;
  status: string;
  position: number;
};
export type CalendarEvent = EventRecord & { task_id?: string | null; proposal_id?: string | null };
export type Schedule = ScheduleRecord;
export type ScheduleException = {
  id: string;
  schedule_id: string;
  date: string;
  kind: 'cancelled' | 'confirmed';
};
export type DocumentRecord = {
  id: string;
  name: string;
  page_count: number;
  text_length: number;
  academic_year: string;
  created_at: string;
  updated_at: string;
  subject_id: string | null;
};
export type Run = {
  id: string;
  document_id: string;
  state: string;
  created_at: string;
  updated_at?: string;
  error?: string | null;
  model?: string;
  calls?: number;
};
export type NoteMeta = {
  id: string;
  document_id: string;
  state: 'running' | 'ready' | 'failed';
  detail: NotesDetail;
  chunks_total: number;
  chunks_done: number;
  error: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
};
export type Note = Omit<NoteMeta, 'title'> & {
  content: { parts: NotesPart[] };
  calls: number;
  model: string;
  /** Time left on the lease of a part that is being generated right now. */
  busy_ms?: number;
};
export type Timetable = {
  id: string;
  title: string;
  academic_year: string;
  semester: string;
  group: string;
  starts_on: string;
  venues: string[];
};
export type Bootstrap = {
  user: { name?: string; github_login?: string; avatar_url?: string | null };
  subjects: Subject[];
  tasks: Task[];
  subtasks: Subtask[];
  events: CalendarEvent[];
  schedules: Schedule[];
  schedule_exceptions: ScheduleException[];
  timetables: Timetable[];
  documents: DocumentRecord[];
  runs: Run[];
  notes: NoteMeta[];
  preferences: Preferences;
};
export type RunDetail = {
  run: Run;
  steps: Record<string, unknown>[];
  result: { proposals: ProposedTask[]; blocks: StudyBlock[]; review: ReviewAgentOutput } | null;
};
export type Usage = {
  usage: { analyses: number; calls: number; input_tokens: number; output_tokens: number };
  limits: { analyses: number; calls: number; max_calls_per_run: number };
};
