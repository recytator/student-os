import { ArrowDownToLine, ArrowLeft, CalendarDays, LogOut, Workflow } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { AnalysisPanel, RUN_STATE } from '../components/analysis';
import { Badge, Button, Card, Empty, Field, PageHeader } from '../components/ui';
import { useStore } from '../lib/store';
import { clock, fmt } from '../lib/time';
import { UsageMeter, useUsage } from './Materials';

export const logout = () =>
  void api('/auth/logout', { method: 'POST' })
    .catch(() => undefined)
    .then(() => location.replace('/'));

export function Settings() {
  const { data, call, go } = useStore();
  const usage = useUsage();
  const [saving, setSaving] = useState(false);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    await call('/preferences', 'PUT', {
      ...data.preferences,
      academic_year: form.get('academic_year'),
      available_from: form.get('available_from'),
      available_to: form.get('available_to'),
      study_days: form.getAll('study_days').map(Number),
      ai_enabled: form.get('ai_enabled') === 'on',
    }).catch(() => undefined);
    setSaving(false);
  };
  return (
    <div className="page">
      <PageHeader title="Ustawienia" />
      <div className="settings-grid">
        <Card title="Nauka i AI">
          <form className="form-stack" onSubmit={save}>
            <div className="form-grid">
              <Field label="Rok akademicki">
                <input
                  name="academic_year"
                  required
                  pattern="[0-9]{4}/[0-9]{4}"
                  defaultValue={data.preferences.academic_year}
                />
              </Field>
              <span />
              <Field label="Uczę się od">
                <input
                  name="available_from"
                  type="time"
                  required
                  defaultValue={data.preferences.available_from}
                />
              </Field>
              <Field label="do">
                <input
                  name="available_to"
                  type="time"
                  required
                  defaultValue={data.preferences.available_to}
                />
              </Field>
            </div>
            <fieldset className="day-picker">
              <legend>Dni na naukę (dla planera bloków)</legend>
              {['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'].map((day, index) => (
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
            <label className="toggle">
              <input
                name="ai_enabled"
                type="checkbox"
                defaultChecked={data.preferences.ai_enabled}
              />
              <span>
                <strong>Funkcje AI</strong>
                <small>
                  Notatki i analiza terminów (Workers AI). Wyłączenie blokuje nowe wywołania modelu.
                </small>
              </span>
            </label>
            <div>
              <Button variant="primary" type="submit" disabled={saving}>
                Zapisz
              </Button>
            </div>
          </form>
        </Card>
        <div className="stack">
          <Card title="Limit AI na dziś">
            <UsageMeter usage={usage} />
            {usage && (
              <p className="muted small">
                Wspólny dla notatek i analizy terminów: {usage.limits.calls} wywołań modelu i{' '}
                {usage.limits.analyses} analizy terminów dziennie. Limit odnawia się o północy.
              </p>
            )}
          </Card>
          <Card title="Eksport">
            <div className="button-row">
              <a className="btn btn-secondary" href="/api/export.ics" download>
                <CalendarDays size={15} /> Kalendarz (ICS)
              </a>
              <a className="btn btn-secondary" href="/api/export" download>
                <ArrowDownToLine size={15} /> Wszystkie dane (JSON)
              </a>
            </div>
            <p className="muted small">
              Plik ICS zaimportujesz do Kalendarza Google, Outlooka lub telefonu.
            </p>
          </Card>
          <Card title="Telefon">
            <p className="muted small">
              W Chrome na Androidzie: menu ⋮ → „Dodaj do ekranu głównego”. StudentOS działa wtedy
              jak aplikacja.
            </p>
          </Card>
          <Card
            title="Historia analiz terminów"
            action={
              <button className="link-btn" onClick={() => go({ page: 'analysis' })}>
                Wszystkie
              </button>
            }
          >
            <p className="muted small">{data.runs.length} uruchomień agentów.</p>
          </Card>
          <Card title="Konto">
            <div className="account">
              {data.user.avatar_url && (
                <img src={data.user.avatar_url} alt="" width={36} height={36} />
              )}
              <div className="grow">
                <strong>{data.user.name || data.user.github_login}</strong>
                <span className="muted small">GitHub · {data.user.github_login}</span>
              </div>
              <Button variant="ghost" onClick={logout}>
                <LogOut size={15} /> Wyloguj
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function AnalysisPage({ id }: { id?: string }) {
  const { data, go } = useStore();
  if (id)
    return (
      <div className="page">
        <button className="back-link" onClick={() => go({ page: 'analysis' })}>
          <ArrowLeft size={15} /> Analizy
        </button>
        <PageHeader
          title={
            data.documents.find((d) => d.id === data.runs.find((r) => r.id === id)?.document_id)
              ?.name ?? 'Analiza terminów'
          }
        />
        <Card>
          <AnalysisPanel runId={id} />
        </Card>
      </div>
    );
  return (
    <div className="page">
      <PageHeader title="Analizy terminów" subtitle="Historia uruchomień agentów na materiałach" />
      {data.runs.length ? (
        <Card flush>
          {data.runs.map((run) => (
            <button
              key={run.id}
              className="doc-row"
              onClick={() => go({ page: 'analysis', id: run.id })}
            >
              <span className="doc-icon">
                <Workflow size={17} />
              </span>
              <span className="grow">
                <strong>
                  {data.documents.find((d) => d.id === run.document_id)?.name ?? 'Dokument'}
                </strong>
                <span className="doc-meta">
                  {fmt.instantDate(run.created_at)} {clock(run.created_at)}
                </span>
              </span>
              <Badge
                tone={
                  run.state === 'failed'
                    ? 'red'
                    : run.state === 'approval'
                      ? 'amber'
                      : run.state === 'committed'
                        ? 'green'
                        : 'accent'
                }
              >
                {RUN_STATE[run.state] ?? run.state}
              </Badge>
            </button>
          ))}
        </Card>
      ) : (
        <Card>
          <Empty icon={Workflow} title="Brak analiz" />
        </Card>
      )}
    </div>
  );
}
