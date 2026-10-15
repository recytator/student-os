import { describe, expect, it } from 'vitest';
import {
  liveConfig,
  operationalDetail,
  goldMetrics,
  selectFixture,
  sourceDateMetrics,
  planningSummary,
} from '../../scripts/live-ai-acceptance.mjs';

describe('Live acceptance safeguards (no remote calls)', () => {
  it('keeps the actual application local and enables only remote D1/AI bindings', () => {
    const config = liveConfig(
      { compatibility_date: '2026-08-06', vars: { GITHUB_CLIENT_SECRET: 'not-copied' } },
      '12345678-abcd-abcd-abcd-123456789012',
      '/workspace/example',
    );
    expect(config.main).toBe('/workspace/example/worker/index.ts');
    expect(config.d1_databases[0].remote).toBe(true);
    expect(config.ai).toEqual({ binding: 'AI', remote: true });
    expect(config.vars.DEV_AUTH).toBe('true');
    expect(config.vars.APP_ORIGIN).toBe('http://127.0.0.1:8900');
    expect(JSON.stringify(config)).not.toContain('not-copied');
    expect(config.vars).not.toHaveProperty('GITHUB_OWNER_ID');
  });
  it('rejects an invalid database identifier before writing a config', () => {
    expect(() => liveConfig({}, '../../bad')).toThrow('INVALID_D1_ID');
  });
  it('limits log artifacts to validated operational fields and excludes arbitrary provider reasoning', () => {
    const projected = operationalDetail({
      run: { state: 'approval' },
      result: { proposals: [] },
      steps: [
        {
          agent: 'review',
          state: 'completed',
          model: 'real-model',
          output_json: '{"accepted_ids":[]}',
          reasoning: 'DO_NOT_COPY',
          hidden_response: 'DO_NOT_COPY',
        },
      ],
    });
    expect(projected.steps[0].output_json).toBe('{"accepted_ids":[]}');
    expect(JSON.stringify(projected)).not.toContain('DO_NOT_COPY');
  });
  it('reports imperfect deadline extraction without fabricating perfect recall', () => {
    const metrics = goldMetrics(
      [{ due_date: '2030-11-20', requires_confirmation: false }],
      [{ due_date: '2030-11-20' }, { due_date: '2030-12-02' }, { due_date: null }],
    );
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(0.5);
    expect(metrics.expected_distinct_dates).toBe(2);
  });
  it('selects only fixed public fixtures and rejects arbitrary paths before any side effects', () => {
    expect(selectFixture()).toBe('tests/fixtures/syllabus-exact.json');
    expect(selectFixture('ambiguous')).toBe('tests/fixtures/syllabus-ambiguous.json');
    for (const value of ['', '../private', 'EXACT', 'exact.json'])
      expect(() => selectFixture(value)).toThrow('INVALID_LIVE_FIXTURE');
  });
  it('uses one-to-one source/date matching for obligations and explicit deadlines', () => {
    const gold = [
      { due_date: '2030-11-20', page: 1, quote: 'Projekt oddanie 20.11.2030.' },
      { due_date: null, page: 2, quote: 'Egzamin: rok do ustalenia.' },
    ];
    const predictions = [
      { due_date: '2030-11-20', sources: [{ page: 1, quote: gold[0]!.quote }] },
      { due_date: '2030-11-20', sources: [{ page: 1, quote: gold[0]!.quote }] },
      { due_date: null, sources: [{ page: 2, quote: gold[1]!.quote }] },
    ];
    const metrics = sourceDateMetrics(predictions, gold);
    expect(metrics.obligations).toMatchObject({
      true_positive: 2,
      false_positive: 1,
      false_negative: 0,
      precision: 2 / 3,
      recall: 1,
      f1: 0.8,
    });
    expect(metrics.explicit_dates).toMatchObject({
      true_positive: 1,
      false_positive: 1,
      false_negative: 0,
      precision: 0.5,
      recall: 1,
    });
    expect(
      sourceDateMetrics(
        [{ due_date: '2030-11-20', sources: [{ page: 2, quote: gold[0]!.quote }] }],
        gold,
      ).obligations.true_positive,
    ).toBe(0);
  });
  it('distinguishes raw, retained and committed planning blocks and preserves validated warnings', () => {
    const summary = planningSummary({
      steps: [
        {
          agent: 'planner',
          state: 'completed',
          output_json: JSON.stringify({
            blocks: [{ id: 'b1' }, { id: 'b2' }],
            warnings: ['Brak wolnych slotów dla pozostałych zadań.'],
          }),
        },
        { agent: 'review', state: 'failed', output_json: 'DO_NOT_COPY' },
      ],
      result: { blocks: [{ id: 'b1' }] },
    });
    expect(summary).toMatchObject({
      raw_planner_blocks: 2,
      retained_reviewed_blocks: 1,
      selected_for_commit: 0,
      committed_blocks: 0,
    });
    expect(summary.warnings).toEqual([
      { agent: 'planner', warnings: ['Brak wolnych slotów dla pozostałych zadań.'] },
    ]);
  });
});
