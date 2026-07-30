export interface ScanConfig {
  includePaths: string[];
  excludePaths: string[];
}

export interface RetentionConfig {
  keepRunsDays: number; // Keep complete runs for N days
  trimLogsDays: number; // Trim logs after N days
  maxLogSizeBytes: number; // Max size for trimmed logs
  cleanupIntervalHours: number; // How often to run cleanup
}

export const DEFAULT_ENGINES = ['ffsubsync', 'autosubsync', 'alass'] as const;
export const SUPPORTED_ENGINES = [...DEFAULT_ENGINES, 'ai-translate'] as const;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseCommaSeparated(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getEnabledEngines(): string[] {
  const configured = parseCommaSeparated(getAppSetting('INCLUDE_ENGINES'));
  const engines = configured.length ? configured : [...DEFAULT_ENGINES];
  const unsupported = engines.filter(
    (engine) => !SUPPORTED_ENGINES.includes(engine as (typeof SUPPORTED_ENGINES)[number]),
  );
  if (unsupported.length) console.warn(`Ignoring unsupported engines: ${unsupported.join(', ')}`);
  return engines.filter((engine) => SUPPORTED_ENGINES.includes(engine as (typeof SUPPORTED_ENGINES)[number]));
}

export function getMaxConcurrentTasks(): number {
  return positiveInteger(getAppSetting('MAX_CONCURRENT_SYNC_TASKS'), 1);
}

function validatePath(path: string): boolean {
  return path.startsWith('/') && !path.includes('\0') && !path.split('/').includes('..');
}

export function getScanConfig(): ScanConfig {
  const scanPaths = parseCommaSeparated(getAppSetting('SCAN_PATHS'));
  const excludePaths = parseCommaSeparated(getAppSetting('EXCLUDE_PATHS'));

  // Validate paths
  const validIncludePaths = scanPaths.filter((path) => {
    const isValid = validatePath(path);
    if (!isValid) {
      console.warn(`${new Date().toLocaleString()} Invalid include path: ${path}`);
    }
    return isValid;
  });

  const validExcludePaths = excludePaths.filter((path) => {
    const isValid = validatePath(path);
    if (!isValid) {
      console.warn(`${new Date().toLocaleString()} Invalid exclude path: ${path}`);
    }
    return isValid;
  });

  if (validIncludePaths.length === 0) {
    console.warn(`${new Date().toLocaleString()} No valid scan paths provided, defaulting to /scan_dir`);
    validIncludePaths.push('/scan_dir');
  }

  return {
    includePaths: validIncludePaths,
    excludePaths: validExcludePaths,
  };
}

export function getRetentionConfig(): RetentionConfig {
  return {
    keepRunsDays: positiveInteger(process.env.RETENTION_KEEP_RUNS_DAYS, 30),
    trimLogsDays: positiveInteger(process.env.RETENTION_TRIM_LOGS_DAYS, 7),
    maxLogSizeBytes: positiveInteger(process.env.RETENTION_MAX_LOG_SIZE, 10_000),
    cleanupIntervalHours: positiveInteger(process.env.RETENTION_CLEANUP_INTERVAL_HOURS, 24),
  };
}
import { getAppSetting } from './settings';
