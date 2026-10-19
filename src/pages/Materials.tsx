import { FileText, FolderOpen, LoaderCircle, Presentation, Sparkles, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  PageHeader,
  Segmented,
  SubjectDot,
  useFeedback,
} from '../components/ui';
import { ACCEPT, extractFile, fileKind } from '../extract';
import { cn } from '../lib/cn';
import { useStore } from '../lib/store';
import { fmt, dayKey } from '../lib/time';
import type { DocumentRecord, NotesDetail, Usage } from '../lib/types';

type Intent = 'notes' | 'deadlines' | 'save';
export const docIcon = (name: string) => (fileKind(name) === 'pptx' ? Presentation : FileText);
export const unitLabel = (name: string, count: number) => {
  const kind = fileKind(name);
  if (kind === 'pptx')
    return `${count} ${count === 1 ? 'slajd' : count < 5 ? 'slajdy' : 'slajdów'}`;
  if (kind === 'pdf') return `${count} ${count === 1 ? 'strona' : count < 5 ? 'strony' : 'stron'}`;
  return `${count} ${count === 1 ? 'część' : count < 5 ? 'części' : 'części'}`;
};

/** Re-reads the shared AI budget whenever `key` changes. */
export function useUsage(key: unknown = null) {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    void api<Usage>('/usage').then(setUsage, () => undefined);
  }, [key]);
  return usage;
}

export function UsageMeter({ usage }: { usage: Usage | null }) {
  if (!usage) return null;
  const used = usage.usage.calls;
  const limit = usage.limits.calls;
  return (
    <div
      className="usage-meter"
      title="Wspólny dzienny limit wywołań AI (notatki i analiza terminów)"
    >
      <span>
        AI dziś: <strong>{used}</strong>/{limit}
      </span>
      <span className="meter">
        <span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
      </span>
    </div>
  );
}

export function Materials() {
  const { data, call, go, route } = useStore();
  const { toast } = useFeedback();
  const [file, setFile] = useState<File | null>(null);
  const [subjectId, setSubjectId] = useState(
    route.id && data.subjects.some((s) => s.id === route.id) ? route.id : '',
  );
  const [intent, setIntent] = useState<Intent>('notes');
  const [detail, setDetail] = useState<NotesDetail>('standard');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const usage = useUsage(data.notes.length);
  const busy = Boolean(progress);
  const choose = (next: File | null) => {
    setFile(next);
    setError('');
    if (next && /sylabus|syllabus|regulamin|karta.?przedmiotu/i.test(next.name))
      setIntent('deadlines');
  };
  const upload = async () => {
    if (!file) return;
    setError('');
    try {
      setProgress('Sprawdzam plik…');
      const extracted = await extractFile(file, setProgress);
      setProgress('Zapisuję tekst…');
      const saved = await call<{ document: DocumentRecord; cached: boolean }>(
        '/documents',
        'POST',
        {
          name: file.name,
          hash: extracted.hash,
          pages: extracted.pages,
          subject_id: subjectId || null,
          academic_year: data.preferences.academic_year,
        },
        { quiet: true },
      );
      const id = saved.document.id;
      if (saved.cached) toast('Ten plik jest już w materiałach — otwieram go.');
      setFile(null);
      if (input.current) input.current.value = '';
      if (intent === 'notes') {
        setProgress('Przygotowuję notatki…');
        await call(`/documents/${id}/notes`, 'POST', { detail }).catch(() => undefined);
        go({ page: 'doc', id });
      } else if (intent === 'deadlines') {
        setProgress('Tworzę analizę terminów…');
        await call(`/documents/${id}/analyze`, 'POST').catch(() => undefined);
        sessionStorage.setItem('studentos-doc-tab', 'deadlines');
        go({ page: 'doc', id });
      } else go({ page: 'doc', id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się odczytać pliku.');
    } finally {
      setProgress('');
    }
  };
  const documents = data.documents.filter((document) => !filter || document.subject_id === filter);
  return (
    <div className="page">
      <PageHeader
        title="Materiały"
        subtitle="Wykłady, sylabusy i notatki w jednym miejscu"
        actions={<UsageMeter usage={usage} />}
      />
      <Card className="upload-card">
        <label
          className={cn('dropzone', dragging && 'is-dragging', file && 'has-file')}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            choose(event.dataTransfer.files[0] ?? null);
          }}
        >
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            aria-label="Wybierz plik"
            disabled={busy}
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
          />
          <Upload size={22} strokeWidth={1.6} />
          <strong>{file ? file.name : 'Upuść plik albo kliknij, aby wybrać'}</strong>
          <span>
            {file
              ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
              : 'PDF, PowerPoint (.pptx), Word (.docx), TXT · tekst odczytywany na urządzeniu'}
          </span>
        </label>
        <div className="upload-options">
          <Field label="Co zrobić z materiałem?" className="span-2">
            <Segmented
              label="Cel materiału"
              value={intent}
              onChange={setIntent}
              options={[
                { value: 'notes', label: 'Notatki AI' },
                { value: 'deadlines', label: 'Terminy z sylabusa' },
                { value: 'save', label: 'Tylko zapisz' },
              ]}
            />
          </Field>
          <Field label="Przedmiot">
            <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
              <option value="">Bez przedmiotu</option>
              {data.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          {intent === 'notes' && (
            <Field label="Szczegółowość">
              <select
                value={detail}
                onChange={(event) => setDetail(event.target.value as NotesDetail)}
              >
                <option value="concise">Zwięzłe</option>
                <option value="standard">Standardowe</option>
                <option value="detailed">Szczegółowe</option>
              </select>
            </Field>
          )}
          <Button
            variant="primary"
            className="upload-submit"
            disabled={!file || busy}
            onClick={() => void upload()}
          >
            {busy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
            {intent === 'save'
              ? 'Zapisz materiał'
              : intent === 'notes'
                ? 'Wgraj i utwórz notatki'
                : 'Wgraj i znajdź terminy'}
          </Button>
        </div>
        {progress && (
          <p className="progress-text" role="status">
            <LoaderCircle size={14} className="spin" /> {progress}
          </p>
        )}
        {error && (
          <p className="notice notice-red" role="alert">
            {error}
          </p>
        )}
        <p className="fine-print">
          Plik zostaje na Twoim urządzeniu — do chmury trafia tylko wyodrębniony tekst. Skany bez
          warstwy tekstowej wymagają OCR.
        </p>
      </Card>

      <div className="section-head">
        <h2>
          Twoje materiały <span className="count">{data.documents.length}</span>
        </h2>
        {data.subjects.length > 0 && data.documents.length > 0 && (
          <select
            aria-label="Filtruj materiały"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="">Wszystkie przedmioty</option>
            {data.subjects
              .filter((s) => data.documents.some((d) => d.subject_id === s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        )}
      </div>
      {documents.length ? (
        <DocumentList documents={documents} />
      ) : (
        <Card>
          <Empty icon={FolderOpen} title="Brak materiałów">
            Wgraj prezentację z wykładu, aby dostać notatki i fiszki, albo sylabus, aby wyłapać
            terminy.
          </Empty>
        </Card>
      )}
    </div>
  );
}

export function DocumentList({ documents }: { documents: DocumentRecord[] }) {
  const { data, go, subject } = useStore();
  return (
    <Card flush>
      {documents.map((document) => {
        const Icon = docIcon(document.name);
        const note = data.notes.find((n) => n.document_id === document.id);
        const run = data.runs.find((r) => r.document_id === document.id);
        const item = subject(document.subject_id);
        return (
          <button
            key={document.id}
            className="doc-row"
            onClick={() => go({ page: 'doc', id: document.id })}
          >
            <span className="doc-icon">
              <Icon size={18} strokeWidth={1.6} />
            </span>
            <span className="grow">
              <strong>{note?.title || document.name}</strong>
              <span className="doc-meta">
                {note?.title && <span>{document.name}</span>}
                {item && (
                  <span className="meta-item">
                    <SubjectDot color={item.color} />
                    {item.name}
                  </span>
                )}
                <span>{unitLabel(document.name, document.page_count)}</span>
                <span>{fmt.dayMonth(dayKey(new Date(document.created_at)))}</span>
              </span>
            </span>
            <span className="doc-status">
              {note?.state === 'ready' && <Badge tone="green">Notatki</Badge>}
              {note?.state === 'running' && (
                <Badge tone="accent">
                  Notatki {note.chunks_done}/{note.chunks_total}
                </Badge>
              )}
              {note?.state === 'failed' && <Badge tone="red">Notatki: błąd</Badge>}
              {run?.state === 'approval' && <Badge tone="amber">Terminy do zatwierdzenia</Badge>}
              {run?.state === 'committed' && <Badge>Terminy zapisane</Badge>}
            </span>
          </button>
        );
      })}
    </Card>
  );
}
