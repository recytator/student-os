import { describe, expect, it } from 'vitest';
import { liveConfig, operationalDetail, goldMetrics } from '../../scripts/live-ai-acceptance.mjs';

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
});
