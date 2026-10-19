import { ArrowLeft, FileSearch, ListChecks, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { AnalysisPanel, RUN_STATE } from '../components/analysis';
import { Flashcards, NotesView, useNote } from '../components/notes';
import { Badge, Button, Card, Empty, Segmented, useFeedback } from '../components/ui';
import { useStore } from '../lib/store';
import { dayKey, fmt } from '../lib/time';
import type { DocumentRecord, Run } from '../lib/types';
import { docIcon, unitLabel } from './Materials';

type Tab = 'notes' | 'cards' | 'deadlines' | 'text';

export function DocumentPage({ id }: { id: string }) {
  const { data } = useStore();
  const document = data.documents.find((item) => item.id === id);
  if (!document)
    return (
      <div className="page">
        <Card>
          <Empty icon={FileSearch} title="Nie znaleziono materiału">
            Mógł zostać usunięty.
          </Empty>
        </Card>
      </div>
    );
  return <DocumentView key={document.id} document={document} />;
}

function DocumentView({ document }: { document: DocumentRecord }) {
  const { data, call, go } = useStore();
  const { confirm } = useFeedback();
  const [tab, setTab] = useState<Tab>(() => {
    const stored = sessionStorage.getItem('studentos-doc-tab') as Tab | null;
    sessionStorage.removeItem('studentos-doc-tab');
    return stored ?? 'notes';
  });
  const [pages, setPages] = useState<{ page: number; text: string }[] | null>(null);
  const [focusPage, setFocusPage] = useState<number | null>(null);
  const noteState = useNote(document.id);
  const runs = data.runs.filter((run) => run.document_id === document.id);
  const run = runs[0];
  const Icon = docIcon(document.name);
  useEffect(() => {
    if (tab === 'text' && !pages)
      void api<{ pages: { page: number; text: string }[] }>(`/documents/${document.id}`).then(
        (r) => setPages(r.pages),
        () => setPages([]),
      );
  }, [tab, pages, document.id]);
  useEffect(() => {
    if (tab === 'text' && pages && focusPage)
      window.document
        .getElementById(`page-${focusPage}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [tab, pages, focusPage]);
  const startAnalysis = async (force = false) => {
    await call<{ run: Run }>(
      `/documents/${document.id}/analyze${force ? '?force=1' : ''}`,
      'POST',
    ).catch(() => undefined);
  };
  const parts =
    noteState.note?.state === 'ready' ? noteState.note.content.parts.filter(Boolean) : [];
  const cardCount = parts.reduce(
    (sum, part) => sum + part.questions.length + part.key_terms.length,
    0,
  );
  return (
    <div className="page doc-page">
      <button className="back-link no-print" onClick={() => go({ page: 'materials' })}>
        <ArrowLeft size={15} /> Materiały
      </button>
      <header className="doc-header">
        <span className="doc-icon doc-icon-lg">
          <Icon size={22} strokeWidth={1.6} />
        </span>
        <div className="grow">
          <h1>{noteState.note?.content.parts[0]?.title || document.name}</h1>
          <p className="doc-meta">
            <span>{document.name}</span>
            <span>{unitLabel(document.name, document.page_count)}</span>
            <span>dodano {fmt.dayMonth(dayKey(new Date(document.created_at)))}</span>
          </p>
        </div>
        <div className="doc-actions no-print">
          <select
            aria-label="Przedmiot materiału"
            value={document.subject_id ?? ''}
            onChange={(event) =>
              void call(`/documents/${document.id}`, 'PATCH', {
                subject_id: event.target.value || null,
              }).catch(() => undefined)
            }
          >
            <option value="">Bez przedmiotu</option>
            {data.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Usuń materiał"
            title="Usuń materiał"
            onClick={() =>
              void confirm({
                title: 'Usunąć materiał?',
                message:
                  'Usunięte zostaną tekst, notatki i analizy tego pliku oraz zadania i terminy zatwierdzone z jego analizy.',
                confirm: 'Usuń',
                danger: true,
              }).then((ok) => {
                if (ok)
                  void call(`/documents/${document.id}`, 'DELETE').then(
                    () => go({ page: 'materials' }),
                    () => undefined,
                  );
              })
            }
          >
            <Trash2 size={16} />
          </Button>
        </div>
      </header>
      <div className="no-print">
        <Segmented
          label="Widok materiału"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'notes', label: 'Notatki' },
            { value: 'cards', label: `Fiszki${cardCount ? ` · ${cardCount}` : ''}` },
            {
              value: 'deadlines',
              label: `Terminy${run ? ` · ${RUN_STATE[run.state] ?? run.state}` : ''}`,
            },
            { value: 'text', label: 'Tekst' },
          ]}
        />
      </div>
      <Card className="doc-body">
        {tab === 'notes' && (
          <NotesView
            documentName={document.name}
            noteState={noteState}
            onPage={(page) => {
              setFocusPage(page);
              setTab('text');
            }}
          />
        )}
        {tab === 'cards' && <Flashcards parts={parts} />}
        {tab === 'deadlines' &&
          (run ? (
            <>
              <AnalysisPanel runId={run.id} />
              {['committed', 'failed'].includes(run.state) && (
                <Button className="mt" onClick={() => void startAnalysis(true)}>
                  Uruchom nową analizę
                </Button>
              )}
            </>
          ) : (
            <div className="notes-empty">
              <Empty icon={ListChecks} title="Terminy i obowiązki">
                Agenci przeczytają materiał (najlepiej sylabus lub regulamin), wyłapią kolokwia,
                projekty i terminy z cytatami ze źródła oraz zaproponują bloki nauki. Wszystko
                zatwierdzasz sam.
              </Empty>
              <Button variant="primary" onClick={() => void startAnalysis()}>
                <ListChecks size={15} /> Przygotuj analizę terminów
              </Button>
            </div>
          ))}
        {tab === 'text' &&
          (pages ? (
            <div className="source-text">
              {pages.map((page) => (
                <section
                  key={page.page}
                  id={`page-${page.page}`}
                  className={focusPage === page.page ? 'is-focus' : ''}
                >
                  <Badge>
                    {document.name.toLowerCase().endsWith('.pptx') ? 'Slajd' : 'Strona'} {page.page}
                  </Badge>
                  <p>{page.text}</p>
                </section>
              ))}
            </div>
          ) : (
            <p className="muted">Wczytuję tekst…</p>
          ))}
      </Card>
    </div>
  );
}
