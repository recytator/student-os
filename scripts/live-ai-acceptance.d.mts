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
