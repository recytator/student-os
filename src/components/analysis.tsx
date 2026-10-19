import {
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronRight,
  FileText,
  LoaderCircle,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { cn } from '../lib/cn';
import { useStore } from '../lib/store';
import { clock, fmt, warsawInstant, dayKey } from '../lib/time';
import type { ProposedTask, RunDetail, StudyBlock } from '../lib/types';
import { PRIORITY_LABEL } from './tasks';
import { Badge, Button, Empty, Field } from './ui';

const STAGES = [
  { id: 'document', name: 'Struktura', description: 'Odczyt sekcji i źródeł' },
  { id: 'deadline', name: 'Terminy', description: 'Obowiązki i daty' },
  { id: 'planner', name: 'Plan nauki', description: 'Propozycje bloków' },
  { id: 'review', name: 'Weryfikacja', description: 'Cytaty, duplikaty, konflikty' },
];
export const RUN_STATE: Record<string, string> = {
  document: 'W toku',
  deadline: 'W toku',
  planner: 'W toku',
  review: 'W toku',
  approval: 'Do zatwierdzenia',
  committed: 'Zatwierdzono',
  failed: 'Przerwano',
};
const datetimeInput = (value: string) => `${dayKey(new Date(value))}T${clock(value)}`;

export function AnalysisPanel({ runId }: { runId: string }) {
  const { call, refresh } = useStore();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [proposals, setProposals] = useState<ProposedTask[]>([]);
  const [blocks, setBlocks] = useState<StudyBlock[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [chosenBlocks, setChosenBlocks] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
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
    setDetail(null);
    setError('');
    void api<RunDetail>(`/runs/${runId}`).then(apply, (e) =>
      setError(e instanceof Error ? e.message : 'Błąd odczytu.'),
    );
  }, [runId, apply]);
  const runAll = async () => {
    if (!detail) return;
    setRunning(true);
    setError('');
    let current = detail;
    try {
      while (alive.current && !['approval', 'committed', 'failed'].includes(current.run.state)) {
        current = await api<RunDetail>(`/runs/${runId}/advance`, { method: 'POST' });
        if (alive.current) apply(current);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Etap nie powiódł się.');
    } finally {
      if (alive.current) setRunning(false);
      void refresh().catch(() => undefined);
    }
  };
  const approve = async () => {
    setSaving(true);
    try {
      await call(`/runs/${runId}/approve`, 'POST', {
        proposals: proposals.filter((p) => chosen.has(p.id)),
        blocks: blocks.filter((b) => chosenBlocks.has(b.id) && chosen.has(b.proposal_id)),
      });
      apply(await api<RunDetail>(`/runs/${runId}`));
    } catch {
      /* Toast shown. */
    } finally {
      setSaving(false);
    }
  };
  const toggle = (set: Set<string>, id: string, update: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  const edit = (id: string, change: Partial<ProposedTask>) =>
    setProposals((all) => all.map((p) => (p.id === id ? { ...p, ...change } : p)));
  if (!detail)
    return error ? (
      <p className="notice notice-red">{error}</p>
    ) : (
      <p className="progress-text">
        <LoaderCircle size={14} className="spin" /> Wczytuję analizę…
      </p>
    );
  const run = detail.run;
  const stageIndex = STAGES.findIndex((stage) => stage.id === run.state);
  const finished = ['approval', 'committed'].includes(run.state);
  const pickedBlocks = blocks.filter(
    (b) => chosenBlocks.has(b.id) && chosen.has(b.proposal_id),
  ).length;
  return (
    <div className="analysis">
      <ol className="stepper">
        {STAGES.map((stage, index) => {
          const done = finished || index < stageIndex;
          const active = run.state === stage.id;
          return (
            <li
              key={stage.id}
              className={cn(
                done && 'is-done',
                active && 'is-active',
                run.state === 'failed' && index === stageIndex && 'is-failed',
              )}
            >
              <span className="step-dot">
                {done ? (
                  <Check size={12} strokeWidth={3} />
                ) : active && running ? (
                  <LoaderCircle size={12} className="spin" />
                ) : (
                  index + 1
                )}
              </span>
              <span>
                <strong>{stage.name}</strong>
                <small>{stage.description}</small>
              </span>
            </li>
          );
        })}
      </ol>
      {!['approval', 'committed', 'failed'].includes(run.state) && (
        <div className="analysis-cta">
          <p className="muted small">
            Czterech agentów kolejno czyta dokument, wyłapuje terminy, proponuje bloki nauki i
            weryfikuje cytaty. Zwykle 4–6 wywołań AI. Nic nie zostanie zapisane bez Twojej zgody.
          </p>
          <Button variant="primary" disabled={running} onClick={() => void runAll()}>
            {running ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />}
            {running ? 'Analizuję…' : stageIndex > 0 ? 'Kontynuuj analizę' : 'Uruchom analizę'}
          </Button>
        </div>
      )}
      {run.state === 'failed' && (
        <p className="notice notice-red">
          <AlertTriangle size={15} /> {run.error ?? 'Analiza została przerwana.'} Możesz uruchomić
          nową analizę z menu dokumentu.
        </p>
      )}
      {error && <p className="notice notice-red">{error}</p>}
      {run.state === 'committed' && (
        <p className="notice notice-green">
          <CheckCheck size={15} /> Zatwierdzone terminy i bloki nauki są w Zadaniach i Planie.
        </p>
      )}
      {run.state === 'approval' && detail.result && (
        <div className="approval">
          {detail.result.review.summary && (
            <p className="review-summary">
              <ShieldCheck size={15} /> {detail.result.review.summary}
            </p>
          )}
          {detail.result.review.issues.map((issue, index) => (
            <p
              key={index}
              className={cn('notice', issue.severity === 'error' ? 'notice-red' : 'notice-amber')}
            >
              <AlertTriangle size={14} /> {issue.message}
            </p>
          ))}
          {proposals.length ? (
            proposals.map((proposal) => (
              <article
                key={proposal.id}
                className={cn('proposal', chosen.has(proposal.id) && 'is-selected')}
              >
                <label className="proposal-head">
                  <input
                    type="checkbox"
                    checked={chosen.has(proposal.id)}
                    onChange={() => toggle(chosen, proposal.id, setChosen)}
                  />
                  <span>Dodaj do zadań</span>
                  <Badge tone={proposal.requires_confirmation ? 'amber' : 'green'}>
                    {proposal.requires_confirmation
                      ? 'Sprawdź datę'
                      : `pewność ${Math.round(proposal.confidence * 100)}%`}
                  </Badge>
                </label>
                <div className="form-grid">
                  <Field label="Tytuł" className="span-2">
                    <input
                      value={proposal.title}
                      maxLength={240}
                      onChange={(e) => edit(proposal.id, { title: e.target.value })}
                    />
                  </Field>
                  <Field label="Termin">
                    <input
                      type="date"
                      value={proposal.due_date ?? ''}
                      onChange={(e) => edit(proposal.id, { due_date: e.target.value || null })}
                    />
                  </Field>
                  <Field label="Priorytet">
                    <select
                      value={proposal.priority}
                      onChange={(e) =>
                        edit(proposal.id, { priority: e.target.value as ProposedTask['priority'] })
                      }
                    >
                      {(['low', 'medium', 'high'] as const).map((p) => (
                        <option key={p} value={p}>
                          {PRIORITY_LABEL[p]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {(detail.result?.proposals.find((p) => p.id === proposal.id)
                  ?.requires_confirmation ||
                  proposal.requires_confirmation) && (
                  <label className="toggle toggle-sm">
                    <input
                      type="checkbox"
                      checked={!proposal.requires_confirmation}
                      onChange={(e) =>
                        edit(proposal.id, { requires_confirmation: !e.target.checked })
                      }
                    />
                    <span>Potwierdzam dane (także jeśli termin jest niepełny)</span>
                  </label>
                )}
                {proposal.duplicate_of && (
                  <p className="warning-text">Możliwy duplikat istniejącego zadania.</p>
                )}
                {proposal.sources.map((source, index) => (
                  <blockquote key={index}>
                    <span>
                      <FileText size={12} /> Strona {source.page}
                    </span>
                    „{source.quote}”
                  </blockquote>
                ))}
              </article>
            ))
          ) : (
            <Empty icon={CheckCheck} title="Nie znaleziono obowiązków" compact />
          )}
          {blocks.length > 0 && (
            <div className="blocks">
              <h3>Proponowane bloki nauki</h3>
              {blocks.map((block) => (
                <div
                  key={block.id}
                  className={cn('block-row', !chosen.has(block.proposal_id) && 'is-disabled')}
                >
                  <input
                    type="checkbox"
                    aria-label={`Zapisz blok ${block.title}`}
                    checked={chosenBlocks.has(block.id) && chosen.has(block.proposal_id)}
                    disabled={!chosen.has(block.proposal_id)}
                    onChange={() => toggle(chosenBlocks, block.id, setChosenBlocks)}
                  />
                  <div className="form-grid grow">
                    <Field label="Blok" className="span-2">
                      <input
                        value={block.title}
                        onChange={(e) =>
                          setBlocks((all) =>
                            all.map((b) =>
                              b.id === block.id ? { ...b, title: e.target.value } : b,
                            ),
                          )
                        }
                      />
                    </Field>
                    {(['start_at', 'end_at'] as const).map((key) => (
                      <Field key={key} label={key === 'start_at' ? 'Od' : 'Do'}>
                        <input
                          type="datetime-local"
                          value={datetimeInput(block[key])}
                          onChange={(e) => {
                            if (!e.target.value) return;
                            const [d, t] = e.target.value.split('T');
                            setBlocks((all) =>
                              all.map((b) =>
                                b.id === block.id ? { ...b, [key]: warsawInstant(d!, t!) } : b,
                              ),
                            );
                          }}
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="approval-bar">
            <span>
              {chosen.size} zadań · {pickedBlocks} bloków nauki
            </span>
            <Button variant="primary" disabled={saving} onClick={() => void approve()}>
              {saving ? <LoaderCircle size={15} className="spin" /> : <CheckCheck size={15} />}{' '}
              Zatwierdź i zapisz
            </Button>
          </div>
        </div>
      )}
      {detail.steps.length > 0 && (
        <details className="tech-details">
          <summary>
            Szczegóły techniczne · {detail.steps.length} etapów · model {run.model ?? '—'}
            <ChevronRight size={14} />
          </summary>
          {detail.steps.map((step, index) => (
            <details key={String(step.id ?? index)} className="log-step">
              <summary>
                <span className={cn('log-dot', step.state === 'failed' && 'is-failed')} />
                <strong>{String(step.agent ?? 'etap')}</strong>
                <span className="muted">{String(step.output_summary || step.state || '')}</span>
                <span className="muted small">
                  {typeof step.duration_ms === 'number'
                    ? `${(step.duration_ms / 1000).toFixed(1)} s`
                    : ''}
                </span>
              </summary>
              <pre>{JSON.stringify(step, null, 2)}</pre>
            </details>
          ))}
          <p className="muted small">
            Utworzono {fmt.instantDate(run.created_at)} {clock(run.created_at)} · ID {run.id}
          </p>
        </details>
      )}
    </div>
  );
}
