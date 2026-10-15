export interface LiveConfiguration {
  main: string;
  vars: { DEV_AUTH: string; APP_ORIGIN: string; AI_MODEL: string };
  ai: { binding: string; remote: boolean };
  d1_databases: Array<{
    binding: string;
    database_id: string;
    database_name: string;
    remote: boolean;
  }>;
}
export function liveConfig(
  original: { compatibility_date?: string; [key: string]: unknown },
  databaseId: string,
  directory?: string,
): LiveConfiguration;
export function operationalDetail(detail: {
  run: unknown;
  result: unknown;
  steps?: Array<Record<string, unknown>>;
}): { run: unknown; result: unknown; steps: Array<Record<string, unknown>> };
export function goldMetrics(
  proposals: Array<{ due_date: string | null; requires_confirmation?: boolean }>,
  gold: Array<{ due_date: string | null }>,
): {
  method: string;
  expected_distinct_dates: number;
  found_distinct_dates: number;
  matched_distinct_dates: number;
  precision: number;
  recall: number;
  requires_manual_confirmation: number;
};
export function main(): Promise<Record<string, unknown>>;
export function selectFixture(value?: string): string;
export interface ExtractionScore {
  true_positive: number;
  false_positive: number;
  false_negative: number;
  precision: number;
  recall: number;
  f1: number;
}
export function sourceDateMetrics(
  proposals: Array<{ due_date: string | null; sources?: Array<{ page: number; quote: string }> }>,
  gold: Array<{ due_date: string | null; page: number; quote: string }>,
): { method: string; obligations: ExtractionScore; explicit_dates: ExtractionScore };
export function planningSummary(detail: {
  steps: Array<Record<string, unknown>>;
  result?: { blocks?: unknown[] };
}): {
  raw_planner_blocks: number | null;
  retained_reviewed_blocks: number | null;
  selected_for_commit: number;
  committed_blocks: number;
  warnings: Array<{ agent: unknown; warnings: string[] }>;
  warning_source: string;
};
