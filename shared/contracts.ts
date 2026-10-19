import { z } from 'zod';

/** Public, shared validation contracts. Dates use Warsaw calendar semantics. */
export const idSchema = z.string().min(1).max(100);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, 'Nieprawidłowa data');
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const instantSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), 'Nieprawidłowy czas lub offset strefy');
export const academicYearSchema = z
  .string()
  .regex(/^\d{4}\/\d{4}$/)
  .refine((value) => {
    const [start, end] = value.split('/').map(Number);
    return end === start! + 1;
  }, 'Rok akademicki musi obejmować kolejne lata');
export const prioritySchema = z.enum(['low', 'medium', 'high']);
export const taskStatusSchema = z.enum(['todo', 'done']);
export const taskKindSchema = z.enum(['task', 'exam', 'colloquium', 'project']);
const titleSchema = z.string().trim().min(1).max(240);
const nullableId = idSchema.nullable().default(null);

export const subjectInputSchema = z
  .object({
    name: titleSchema,
    teacher: z.string().trim().max(160).default(''),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#8b8cf8'),
    class_type: z.string().trim().max(80).default('wykład'),
  })
  .strict();
export const taskInputSchema = z
  .object({
    title: titleSchema,
    subject_id: nullableId,
    due_date: dateSchema.nullable().default(null),
    priority: prioritySchema.default('medium'),
    status: taskStatusSchema.default('todo'),
    kind: taskKindSchema.default('task'),
    document_id: nullableId,
    notes: z.string().max(10000).default(''),
  })
  .strict();
export const eventInputSchema = z
  .object({
    title: titleSchema,
    subject_id: nullableId,
    start_at: instantSchema,
    end_at: instantSchema,
    location: z.string().trim().max(200).default(''),
    document_id: nullableId,
  })
  .strict();
export const scheduleInputSchema = z
  .object({
    subject_id: idSchema,
    weekday: z.number().int().min(1).max(7),
    start_time: timeSchema,
    end_time: timeSchema,
    valid_from: dateSchema,
    valid_to: dateSchema,
    location: z.string().trim().max(200).default(''),
    class_type: z.string().trim().max(40).default(''),
    notes: z.string().trim().max(500).default(''),
    tentative: z.number().int().min(0).max(1).default(0),
  })
  .strict();
export const scheduleExceptionInputSchema = z
  .object({ date: dateSchema, kind: z.enum(['cancelled', 'confirmed']) })
  .strict();
export const documentPatchSchema = z
  .object({ subject_id: nullableId.optional(), name: z.string().trim().min(1).max(240).optional() })
  .strict();
export const notesDetailSchema = z.enum(['concise', 'standard', 'detailed']);
export const notesRequestSchema = z
  .object({ detail: notesDetailSchema.default('standard') })
  .strict();
/** One AI pass over a bounded chunk of a document. Server-side sanitizing keeps it within limits. */
export const notesPartSchema = z
  .object({
    title: z.string().max(200),
    summary: z.string().max(2000),
    sections: z
      .array(
        z
          .object({
            heading: z.string().max(200),
            pages: z.array(z.number().int().min(1).max(300)).max(20),
            points: z.array(z.string().max(700)).min(1).max(14),
          })
          .strict(),
      )
      .max(14),
    key_terms: z
      .array(z.object({ term: z.string().max(140), definition: z.string().max(600) }).strict())
      .max(24),
    questions: z
      .array(z.object({ question: z.string().max(400), answer: z.string().max(900) }).strict())
      .max(16),
  })
  .strict();
export const subtaskInputSchema = z
  .object({
    title: titleSchema,
    status: taskStatusSchema.default('todo'),
    position: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const preferencesInputSchema = z
  .object({
    timezone: z.literal('Europe/Warsaw').default('Europe/Warsaw'),
    locale: z.literal('pl-PL').default('pl-PL'),
    academic_year: academicYearSchema.default('2026/2027'),
    available_from: timeSchema.default('16:00'),
    available_to: timeSchema.default('21:00'),
    study_days: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5]),
    ai_enabled: z.boolean().default(true),
  })
  .strict();

const recordFields = {
  id: idSchema,
  user_id: idSchema,
  created_at: z.string(),
  updated_at: z.string(),
};
export const subjectSchema = subjectInputSchema.extend(recordFields);
export const taskSchema = taskInputSchema.extend(recordFields);
export const eventSchema = eventInputSchema.extend(recordFields);
export const scheduleSchema = scheduleInputSchema.extend(recordFields);
export const sourceSchema = z
  .object({
    page: z.number().int().min(1).max(300),
    quote: z.string().min(1).max(1200),
  })
  .strict();
export const pageSchema = z
  .object({ page: z.number().int().min(1).max(300), text: z.string().max(30000) })
  .strict();
export const documentUploadSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    pages: z.array(pageSchema).min(1).max(100),
    subject_id: nullableId,
    academic_year: academicYearSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.pages.reduce((sum, page) => sum + page.text.length, 0) > 120000)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Dokument przekracza limit 120 000 znaków',
      });
    if (new Set(value.pages.map((page) => page.page)).size !== value.pages.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Numery stron muszą być unikalne' });
    if (!value.pages.some((page) => page.text.trim().length >= 20))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Brak tekstu. Skan PDF wymaga OCR.',
      });
  });

/** Each role has a separate input/output contract; raw PDF content is untrusted. */
export const documentAgentInputSchema = z
  .object({
    name: z.string(),
    pages: z.array(pageSchema),
    academic_year: z.string(),
    subject_name: z.string().nullable(),
  })
  .strict();
export const documentAgentOutputSchema = z
  .object({
    subject_name: z.string().max(240).nullable(),
    document_type: z.enum(['syllabus', 'presentation', 'assignment', 'schedule', 'other']),
    summary: z.string().max(3000),
    sections: z
      .array(
        z
          .object({
            title: z.string().max(240),
            kind: z.enum(['requirement', 'deadline', 'content', 'other']),
            sources: z.array(sourceSchema).min(1).max(20),
          })
          .strict(),
      )
      .max(80),
    warnings: z.array(z.string().max(500)).max(30),
  })
  .strict();
export const proposedTaskSchema = z
  .object({
    id: idSchema,
    title: titleSchema,
    subject_id: idSchema.nullable(),
    due_date: dateSchema.nullable(),
    priority: prioritySchema,
    estimated_minutes: z.number().int().min(15).max(10080).nullable(),
    sources: z.array(sourceSchema).min(1).max(10),
    confidence: z.number().min(0).max(1),
    requires_confirmation: z.boolean(),
    duplicate_of: z.string().nullable(),
  })
  .strict();
export const deadlineAgentInputSchema = z
  .object({
    document: documentAgentOutputSchema,
    pages: z.array(pageSchema),
    academic_year: z.string(),
    today: dateSchema,
    existing_tasks: z.array(taskSchema),
  })
  .strict();
export const deadlineAgentOutputSchema = z
  .object({
    proposals: z.array(proposedTaskSchema).max(60),
    warnings: z.array(z.string().max(500)).max(30),
  })
  .strict();
export const studyBlockSchema = z
  .object({
    id: idSchema,
    proposal_id: idSchema,
    title: titleSchema,
    start_at: instantSchema,
    end_at: instantSchema,
    estimated: z.literal(true),
    reason: z.string().max(600),
  })
  .strict();
export const plannerAgentInputSchema = z
  .object({
    proposals: z.array(proposedTaskSchema),
    events: z.array(eventSchema),
    schedules: z.array(scheduleSchema),
    preferences: preferencesInputSchema,
    today: dateSchema,
  })
  .strict();
export const plannerAgentOutputSchema = z
  .object({
    blocks: z.array(studyBlockSchema).max(100),
    warnings: z.array(z.string().max(500)).max(30),
  })
  .strict();
export const reviewIssueSchema = z
  .object({
    proposal_id: z.string().nullable(),
    severity: z.enum(['info', 'warning', 'error']),
    code: z.enum([
      'missing_date',
      'unsupported_date',
      'invalid_source',
      'duplicate',
      'conflict',
      'invalid_structure',
      'other',
    ]),
    message: z.string().max(800),
  })
  .strict();
export const reviewAgentInputSchema = z
  .object({
    pages: z.array(pageSchema),
    document: documentAgentOutputSchema,
    deadlines: deadlineAgentOutputSchema,
    plan: plannerAgentOutputSchema,
    existing_tasks: z.array(taskSchema),
    events: z.array(eventSchema),
  })
  .strict();
export const reviewAgentOutputSchema = z
  .object({
    accepted_ids: z.array(idSchema).max(60),
    rejected_ids: z.array(idSchema).max(60),
    issues: z.array(reviewIssueSchema).max(100),
    needs_revision: z.boolean(),
    revise_agent: z.enum(['document', 'deadline', 'planner']).nullable(),
    summary: z.string().max(2000),
  })
  .strict();
export const runStateSchema = z.enum([
  'document',
  'deadline',
  'planner',
  'review',
  'approval',
  'committed',
  'failed',
]);
export const approvalSchema = z
  .object({
    proposals: z.array(proposedTaskSchema).max(60),
    blocks: z.array(studyBlockSchema).max(100),
  })
  .strict();
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export type SubjectInput = z.infer<typeof subjectInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type EventInput = z.infer<typeof eventInputSchema>;
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
export type Subject = z.infer<typeof subjectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type CalendarEvent = z.infer<typeof eventSchema>;
export type ClassSchedule = z.infer<typeof scheduleSchema>;
export type Preferences = z.infer<typeof preferencesInputSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type DocumentUpload = z.infer<typeof documentUploadSchema>;
export type DocumentPage = z.infer<typeof pageSchema>;
export type DocumentAgentOutput = z.infer<typeof documentAgentOutputSchema>;
export type DeadlineAgentOutput = z.infer<typeof deadlineAgentOutputSchema>;
export type PlannerAgentOutput = z.infer<typeof plannerAgentOutputSchema>;
export type ReviewAgentOutput = z.infer<typeof reviewAgentOutputSchema>;
export type TaskKind = z.infer<typeof taskKindSchema>;
export type NotesPart = z.infer<typeof notesPartSchema>;
export type NotesDetail = z.infer<typeof notesDetailSchema>;
export type ProposedTask = z.infer<typeof proposedTaskSchema>;
export type StudyBlock = z.infer<typeof studyBlockSchema>;
export type RunState = z.infer<typeof runStateSchema>;
