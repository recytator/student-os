export function configuration(env: Record<string, string | undefined>): {
  origin: string;
  ownerGithubId: string;
  ai: boolean;
};
export function testSession(now?: number): { token: string; digest: string; expires: number };
interface Source {
  page: number;
  quote: string;
}
interface Gold {
  due_date: string | null;
  page: number;
  quote: string;
}
interface PublicProposal {
  id: string;
  title: string;
  due_date: string | null;
  requires_confirmation?: boolean;
  sources?: Source[];
}
export function knownProposals<T extends PublicProposal>(
  proposals: T[],
  acceptedIds: string[],
  gold: Gold[],
  prefix: string,
  subjectId: string,
): Array<T & { title: string; subject_id: string }>;
interface Block {
  id: string;
  proposal_id: string;
  title: string;
  start_at: string;
  end_at: string;
}
interface CurrentPlanning {
  preferences: { study_days: number[]; available_from: string; available_to: string };
  events: Array<{ start_at: string; end_at: string }>;
  schedules: Array<{
    weekday: number;
    valid_from: string;
    valid_to: string;
    start_time: string;
    end_time: string;
  }>;
}
export function safeStudyBlocks<T extends Block>(
  blocks: T[],
  proposals: Array<{ id: string; due_date: string | null }>,
  current: CurrentPlanning,
  prefix: string,
  now?: number,
): T[];
export function fixtureMetrics(
  proposals: Array<{ due_date: string | null; sources?: Source[] }>,
  gold: Gold[],
): {
  method: string;
  expected: number;
  predicted: number;
  matched: number;
  precision: number;
  recall: number;
};
export function hasAuthSecrets(value: unknown): boolean;
export function main(env?: Record<string, string | undefined>): Promise<Record<string, unknown>>;
