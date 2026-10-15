import { describe, expect, it } from 'vitest';
import {
  configuration,
  testSession,
  knownProposals,
  safeStudyBlocks,
  fixtureMetrics,
  hasAuthSecrets,
} from '../../scripts/production-acceptance.mjs';
import { createHash } from 'node:crypto';

describe('production HTTPS acceptance guards — no remote calls', () => {
  const env = {
    FREE_PLAN_CONFIRMED: 'true',
    CLOUDFLARE_API_TOKEN: 'test-only',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    GITHUB_OWNER_ID: '166433083',
  };
  it('pins HTTPS origin and requires numeric existing owner and explicit Free confirmation', () => {
    expect(configuration(env).origin).toBe('https://studentos.recytator.workers.dev');
  });
  it('rejects missing authorization without issuing a session', () => {
    expect(() => configuration({ ...env, FREE_PLAN_CONFIRMED: 'false' })).toThrow('WORKERS_FREE');
    expect(() => configuration({ ...env, GITHUB_OWNER_ID: 'fake-owner' })).toThrow(
      'NUMERIC_EXISTING_OWNER',
    );
    expect(() => configuration({ ...env, APP_URL: 'https://evil.example' })).toThrow(
      'UNVERIFIED_PRODUCTION_ORIGIN',
    );
  });
  it('mints only a 10-minute opaque test session hash compatible with auth.ts', () => {
    const session = testSession(1_000_000);
    expect(session.expires).toBe(1600);
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.digest).toBe(createHash('sha256').update(session.token).digest('base64url'));
    expect(session.token).not.toBe(testSession(1_000_000).token);
  });
  it('requires review approval, complete gold date and actual fixture page/quote', () => {
    const gold = [{ due_date: '2026-11-20', page: 1, quote: 'Projekt do 20.11.2026.' }];
    const proposal = {
      id: 'p1',
      title: 'Projekt',
      due_date: '2026-11-20',
      requires_confirmation: false,
      sources: [{ page: 1, quote: 'Projekt do 20.11.2026.' }],
    };
    expect(knownProposals([proposal], ['p1'], gold, 'PROD-QA-test', 'subject')[0]).toMatchObject({
      title: 'PROD-QA-test Projekt',
      due_date: '2026-11-20',
      subject_id: 'subject',
    });
    expect(knownProposals([proposal], [], gold, 'PROD-QA-test', 'subject')).toEqual([]);
    expect(
      knownProposals(
        [{ ...proposal, requires_confirmation: true }],
        ['p1'],
        gold,
        'prefix',
        'subject',
      ),
    ).toEqual([]);
    expect(
      knownProposals(
        [{ ...proposal, sources: [{ page: 2, quote: proposal.sources[0].quote }] }],
        ['p1'],
        gold,
        'prefix',
        'subject',
      ),
    ).toEqual([]);
  });
  it('does not hide duplicate predictions or fabricate perfect source/date recall', () => {
    const gold = [
      { due_date: '2026-11-20', page: 1, quote: 'Projekt do 20.11.2026.' },
      { due_date: '2026-12-04', page: 2, quote: 'Kolokwium 04.12.2026.' },
    ];
    const proposal = { due_date: '2026-11-20', sources: [{ page: 1, quote: gold[0].quote }] };
    expect(fixtureMetrics([proposal, proposal], gold)).toMatchObject({
      matched: 1,
      precision: 0.5,
      recall: 0.5,
    });
    expect(fixtureMetrics([{ ...proposal, sources: [] }], gold)).toMatchObject({
      precision: 0,
      recall: 0,
    });
  });
  it('rejects authentication secret keys recursively without logging export data', () => {
    expect(hasAuthSecrets({ tasks: [{ notes: 'ordinary note' }] })).toBe(false);
    expect(hasAuthSecrets({ nested: { sessions: [{ id: 'test' }] } })).toBe(true);
    expect(hasAuthSecrets({ user: { access_token: 'test' } })).toBe(true);
  });
  it('includes safe production study blocks for selected gold proposals and namespaces only titles', () => {
    const block = {
      id: 'b1',
      proposal_id: 'p1',
      title: 'Nauka',
      start_at: '2026-11-18T17:00:00+01:00',
      end_at: '2026-11-18T18:00:00+01:00',
      estimated: true,
    };
    const current = {
      preferences: { study_days: [1, 2, 3, 4, 5], available_from: '16:00', available_to: '21:00' },
      events: [],
      schedules: [],
    };
    const selected = [{ id: 'p1', due_date: '2026-11-20' }];
    const result = safeStudyBlocks(
      [block],
      selected,
      current,
      'PROD-QA-test',
      Date.parse('2026-10-15T10:00:00Z'),
    );
    expect(result).toEqual([{ ...block, title: 'PROD-QA-test Nauka' }]);
    expect(safeStudyBlocks([block], [], current, 'PROD-QA-test', 0)).toEqual([]);
  });
  it('omits conflicts with genuine owner events, classes and other selected study blocks', () => {
    const block = {
      id: 'b1',
      proposal_id: 'p1',
      title: 'Nauka',
      start_at: '2026-11-18T17:00:00+01:00',
      end_at: '2026-11-18T18:00:00+01:00',
    };
    const current = {
      preferences: { study_days: [1, 2, 3, 4, 5], available_from: '16:00', available_to: '21:00' },
      events: [],
      schedules: [],
    };
    const selected = [{ id: 'p1', due_date: '2026-11-20' }];
    expect(
      safeStudyBlocks([block], selected, { ...current, events: [block] }, 'prefix', 0),
    ).toEqual([]);
    expect(
      safeStudyBlocks(
        [block],
        selected,
        {
          ...current,
          schedules: [
            {
              weekday: 3,
              valid_from: '2026-10-01',
              valid_to: '2027-01-01',
              start_time: '17:00',
              end_time: '18:00',
            },
          ],
        },
        'prefix',
        0,
      ),
    ).toEqual([]);
    expect(
      safeStudyBlocks([block, { ...block, id: 'b2' }], selected, current, 'prefix', 0),
    ).toHaveLength(1);
  });
});
