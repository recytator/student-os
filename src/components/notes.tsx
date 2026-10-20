import {
  BookOpenCheck,
  Check,
  ClipboardCopy,
  Download,
  LoaderCircle,
  Printer,
  RefreshCw,
  RotateCcw,
  Shuffle,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, apiStream } from '../api';
import { cn } from '../lib/cn';
import { useStore } from '../lib/store';
import type { Note, NotesDetail, NotesPart } from '../lib/types';
import { Badge, Button, Empty, useFeedback } from './ui';

const DETAIL_LABEL: Record<NotesDetail, string> = {
  concise: 'Zwięzłe',
  standard: 'Standardowe',
  detailed: 'Szczegółowe',
};

export function notesMarkdown(name: string, parts: NotesPart[]) {
  const lines: string[] = [`# ${parts[0]?.title || name}`, '', `_Źródło: ${name}_`, ''];
  for (const part of parts) {
    if (parts.length > 1) lines.push(`## ${part.title}`, '');
    if (part.summary) lines.push(`> ${part.summary}`, '');
    for (const section of part.sections) {
      lines.push(
        `${parts.length > 1 ? '###' : '##'} ${section.heading}${section.pages.length ? ` (s. ${section.pages.join(', ')})` : ''}`,
        '',
      );
      for (const point of section.points) lines.push(`- ${point}`);
      lines.push('');
    }
  }
  const terms = parts.flatMap((part) => part.key_terms);
  if (terms.length) {
    lines.push('## Pojęcia', '');
    for (const term of terms) lines.push(`- **${term.term}** — ${term.definition}`);
    lines.push('');
  }
  const questions = parts.flatMap((part) => part.questions);
  if (questions.length) {
    lines.push('## Pytania sprawdzające', '');
    questions.forEach((q, index) => lines.push(`${index + 1}. ${q.question}`, `   - ${q.answer}`));
  }
  return lines.join('\n');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const failedMessage = 'Nie udało się wygenerować notatek.';

/**
 * Loads the note and, while it is running, advances it one part per request. A dropped
 * connection (phone locked, network switch) is not a failure: the server finishes the part,
 * so the hook waits for it and continues.
 */
export function useNote(documentId: string) {
  const { data, call, refresh } = useStore();
  const meta = data.notes.find((note) => note.document_id === documentId);
  const [note, setNote] = useState<Note | null>(null);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const active = useRef(true);
  const running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!meta) {
      setNote(null);
      return;
    }
    if (running.current) return;
    void api<Note>(`/notes/${meta.id}`).then(
      (value) => active.current && !running.current && setNote(value),
      () => undefined,
    );
  }, [meta?.id, meta?.updated_at]);
  const run = useCallback(
    async (start: Note) => {
      if (running.current) return;
      running.current = true;
      let current = start;
      let drops = 0;
      const show = (value: Note) => {
        current = value;
        if (active.current) setNote(value);
      };
      setWorking(true);
      setError('');
      setStatus('');
      try {
        while (active.current && current.state !== 'ready') {
          if (current.busy_ms) {
            // Another request (often our own, dropped one) still holds this part.
            setStatus('Kończę rozpoczętą część…');
            await sleep(Math.min(current.busy_ms + 500, 8000));
            show(await api<Note>(`/notes/${current.id}`));
            if (current.state === 'failed') throw new Error(current.error ?? failedMessage);
            continue;
          }
          try {
            setStatus('');
            show(await apiStream<Note>(`/notes/${current.id}/advance`));
            drops = 0;
            if (current.state === 'failed') throw new Error(current.error ?? failedMessage);
          } catch (e) {
            if (e instanceof ApiError && e.code === 'NOTES_BUSY') {
              const details = e.details as { retry_after_ms?: number } | undefined;
              current = { ...current, busy_ms: details?.retry_after_ms ?? 5000 };
              continue;
            }
            if (e instanceof ApiError || !(e instanceof TypeError)) throw e;
            if (++drops > 4)
              throw new Error(
                'Brak połączenia z serwerem. Gotowe części są zapisane — wznów, gdy wróci internet.',
              );
            setStatus('Połączenie przerwane — wznawiam…');
            await sleep(2000 * drops);
            try {
              show(await api<Note>(`/notes/${current.id}`));
            } catch {
              // Still offline; the next attempt retries.
            }
            if (current.state === 'failed') throw new Error(current.error ?? failedMessage);
          }
        }
      } catch (e) {
        if (active.current) setError(e instanceof Error ? e.message : failedMessage);
      } finally {
        running.current = false;
        if (active.current) {
          setWorking(false);
          setStatus('');
        }
        void refresh().catch(() => undefined);
      }
    },
    [refresh],
  );
  useEffect(() => {
    if (note?.state === 'running' && !error) void run(note);
    // Only auto-continue a running note once per load.
  }, [note?.id, note?.state]);
  useEffect(() => {
    // Phones suspend background tabs; pick the work up again when the user comes back.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || running.current || !note) return;
      if (note.state !== 'running') return;
      void api<Note>(`/notes/${note.id}`).then(
        (value) => {
          if (!active.current) return;
          setNote(value);
          if (value.state === 'running') void run(value);
        },
        () => undefined,
      );
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [note, run]);
  const start = async (detail: NotesDetail) => {
    setError('');
    try {
      const created = await call<Note>(
        `/documents/${documentId}/notes`,
        'POST',
        { detail },
        { quiet: true },
      );
      setNote(created);
      await run(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się rozpocząć.');
    }
  };
  return { note, working, status, error, start, resume: () => note && run(note) };
}

function Elapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="tabular">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

export function NotesView({
  documentName,
  noteState,
  onPage,
}: {
  documentName: string;
  noteState: ReturnType<typeof useNote>;
  onPage: (page: number) => void;
}) {
  const { note, working, status, error, start, resume } = noteState;
  const { toast, confirm } = useFeedback();
  const [detail, setDetail] = useState<NotesDetail>(note?.detail ?? 'standard');
  const parts = note?.content.parts.filter(Boolean) ?? [];
  if (!note)
    return (
      <div className="notes-empty">
        <Empty icon={Sparkles} title="Notatki z tego materiału">
          AI przygotuje streszczenie, uporządkowane sekcje z numerami stron, słowniczek pojęć i
          pytania do fiszek. Zużywa zwykle 1–3 wywołania z dziennego limitu.
        </Empty>
        <div className="notes-start">
          <select
            aria-label="Szczegółowość notatek"
            value={detail}
            onChange={(e) => setDetail(e.target.value as NotesDetail)}
          >
            {(Object.keys(DETAIL_LABEL) as NotesDetail[]).map((value) => (
              <option key={value} value={value}>
                {DETAIL_LABEL[value]}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={() => void start(detail)}>
            <Sparkles size={15} /> Utwórz notatki
          </Button>
        </div>
        {error && <p className="notice notice-red">{error}</p>}
      </div>
    );
  if (note.state !== 'ready') {
    const failed = !working && (note.state === 'failed' || Boolean(error));
    const shown = error || note.error;
    return (
      <div className="notes-status">
        <div className="progress-head">
          {working ? <LoaderCircle size={20} className="spin" /> : <Sparkles size={20} />}
          <div>
            <strong>
              {failed
                ? 'Generowanie wstrzymane'
                : `Tworzę notatki · część ${Math.min(note.chunks_done + 1, note.chunks_total)} z ${note.chunks_total}`}
            </strong>
            <p className="notes-hint">
              {failed
                ? note.chunks_done
                  ? `Gotowe części (${note.chunks_done} z ${note.chunks_total}) są zapisane. Możesz wznowić od miejsca przerwania.`
                  : 'Nic nie zostało utracone. Możesz spróbować ponownie.'
                : status ||
                  'Zwykle 20–60 s na część. Możesz zablokować telefon — praca trwa na serwerze.'}
              {working && (
                <>
                  {' · '}
                  <Elapsed key={note.chunks_done} />
                </>
              )}
            </p>
          </div>
        </div>
        <div className="meter meter-lg" aria-hidden>
          <span
            style={{
              width: `${Math.max(working ? 4 : 0, (note.chunks_done / note.chunks_total) * 100)}%`,
            }}
          />
        </div>
        {failed && shown && <p className="notice notice-red">{shown}</p>}
        {!working && (
          <div className="notes-status-actions">
            <Button variant="primary" onClick={() => void resume()}>
              <RefreshCw size={15} /> {note.chunks_done ? 'Wznów' : 'Spróbuj ponownie'}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void confirm({
                  title: 'Zacząć od nowa?',
                  message: 'Gotowe części zostaną usunięte, a notatki wygenerowane ponownie.',
                  confirm: 'Zacznij od nowa',
                }).then((ok) => ok && void start(note.detail))
              }
            >
              <RotateCcw size={15} /> Od nowa
            </Button>
          </div>
        )}
      </div>
    );
  }
  const markdown = notesMarkdown(documentName, parts);
  const terms = parts.flatMap((part) => part.key_terms);
  const questions = parts.flatMap((part) => part.questions);
  return (
    <article className="notes">
      <div className="notes-toolbar no-print">
        <Badge>{DETAIL_LABEL[note.detail]}</Badge>
        <span className="grow" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void navigator.clipboard.writeText(markdown).then(
              () => toast('Skopiowano notatki (Markdown).'),
              () => toast('Nie udało się skopiować.', { tone: 'error' }),
            )
          }
        >
          <ClipboardCopy size={14} /> Kopiuj
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
            );
            const link = Object.assign(document.createElement('a'), {
              href: url,
              download: `${documentName.replace(/\.[^.]+$/, '')} — notatki.md`,
            });
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download size={14} /> .md
        </Button>
        <Button size="sm" variant="ghost" onClick={() => window.print()}>
          <Printer size={14} /> Drukuj / PDF
        </Button>
        <select
          aria-label="Szczegółowość nowej wersji"
          value={detail}
          onChange={(e) => setDetail(e.target.value as NotesDetail)}
        >
          {(Object.keys(DETAIL_LABEL) as NotesDetail[]).map((value) => (
            <option key={value} value={value}>
              {DETAIL_LABEL[value]}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={() =>
            void confirm({
              title: 'Wygenerować notatki ponownie?',
              message:
                'Obecne notatki zostaną zastąpione nową wersją. Zużyje to wywołania AI z dziennego limitu.',
              confirm: 'Generuj',
            }).then((ok) => ok && void start(detail))
          }
        >
          <RotateCcw size={14} /> Od nowa
        </Button>
      </div>
      {parts.map((part, index) => (
        <section key={index} className="notes-part">
          {parts.length > 1 && <h2>{part.title}</h2>}
          {part.summary && <p className="notes-summary">{part.summary}</p>}
          {part.sections.map((section, sectionIndex) => (
            <div className="notes-section" key={sectionIndex}>
              <h3>
                {section.heading}
                {section.pages.map((page) => (
                  <button
                    key={page}
                    className="page-chip no-print"
                    onClick={() => onPage(page)}
                    title="Pokaż w tekście źródłowym"
                  >
                    s. {page}
                  </button>
                ))}
              </h3>
              <ul>
                {section.points.map((point, pointIndex) => (
                  <li key={pointIndex}>{point}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {terms.length > 0 && (
        <section className="notes-part">
          <h2>Pojęcia</h2>
          <dl className="glossary">
            {terms.map((term, index) => (
              <div key={index}>
                <dt>{term.term}</dt>
                <dd>{term.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {questions.length > 0 && (
        <section className="notes-part">
          <h2>Pytania sprawdzające</h2>
          <ol className="questions">
            {questions.map((question, index) => (
              <li key={index}>
                <details>
                  <summary>{question.question}</summary>
                  <p>{question.answer}</p>
                </details>
              </li>
            ))}
          </ol>
        </section>
      )}
      <p className="fine-print">
        Notatki wygenerowało AI na podstawie tekstu materiału — sprawdzaj kluczowe fakty w źródle.
      </p>
    </article>
  );
}

type Card = { front: string; back: string; kind: 'question' | 'term' };
const shuffle = <T,>(items: T[]) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
};

export function Flashcards({ parts }: { parts: NotesPart[] }) {
  const all = useMemo<Card[]>(
    () => [
      ...parts.flatMap((part) =>
        part.questions.map((q) => ({
          front: q.question,
          back: q.answer,
          kind: 'question' as const,
        })),
      ),
      ...parts.flatMap((part) =>
        part.key_terms.map((term) => ({
          front: term.term,
          back: term.definition,
          kind: 'term' as const,
        })),
      ),
    ],
    [parts],
  );
  const [deck, setDeck] = useState(all);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  useEffect(() => {
    setDeck(all);
    setKnown(0);
    setFlipped(false);
  }, [all]);
  const card = deck[0];
  const answer = useCallback((ok: boolean) => {
    setFlipped(false);
    setDeck((current) => {
      const [first, ...rest] = current;
      if (!first) return current;
      return ok ? rest : [...rest.slice(0, 3), first, ...rest.slice(3)];
    });
    if (ok) setKnown((n) => n + 1);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select')) return;
      if (event.key === ' ') {
        event.preventDefault();
        setFlipped((value) => !value);
      } else if (flipped && (event.key === 'ArrowRight' || event.key === '2')) answer(true);
      else if (flipped && (event.key === 'ArrowLeft' || event.key === '1')) answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, flipped]);
  if (!all.length)
    return (
      <Empty icon={BookOpenCheck} title="Brak fiszek">
        Wygeneruj notatki, aby dostać pytania i pojęcia do powtórki.
      </Empty>
    );
  if (!card)
    return (
      <div className="flash-done">
        <Empty icon={Check} title="Wszystkie fiszki opanowane">
          {all.length} {all.length === 1 ? 'fiszka' : 'fiszek'} w tej sesji.
        </Empty>
        <Button
          variant="primary"
          onClick={() => {
            setDeck(shuffle(all));
            setKnown(0);
          }}
        >
          <Shuffle size={15} /> Jeszcze raz
        </Button>
      </div>
    );
  return (
    <div className="flashcards">
      <div className="flash-head">
        <span>
          Opanowane {known}/{all.length}
        </span>
        <div className="meter">
          <span style={{ width: `${(known / all.length) * 100}%` }} />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setDeck(shuffle(deck))}>
          <Shuffle size={14} /> Tasuj
        </Button>
      </div>
      <button
        type="button"
        className={cn('flash-card', flipped && 'is-flipped')}
        onClick={() => setFlipped(!flipped)}
        aria-label={flipped ? 'Pokaż pytanie' : 'Pokaż odpowiedź'}
      >
        <span className="flash-kind">
          {flipped ? card.front : card.kind === 'term' ? 'Pojęcie' : 'Pytanie'}
        </span>
        <span className="flash-text">{flipped ? card.back : card.front}</span>
        <span className="flash-hint">
          {flipped ? 'Odpowiedź' : 'Kliknij lub spacja, aby odwrócić'}
        </span>
      </button>
      <div className="flash-actions">
        <Button disabled={!flipped} onClick={() => answer(false)}>
          <X size={15} /> Jeszcze nie
        </Button>
        <Button variant="primary" disabled={!flipped} onClick={() => answer(true)}>
          <Check size={15} /> Umiem
        </Button>
      </div>
    </div>
  );
}
