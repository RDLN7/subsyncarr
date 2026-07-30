import { StateManager } from './stateManager';

export const APP_SETTING_DEFAULTS: Record<string, string> = {
  SCAN_PATHS: '/movies, /tv, /media',
  EXCLUDE_PATHS: '',
  INCLUDE_ENGINES: 'ffsubsync,autosubsync,alass',
  MAX_CONCURRENT_SYNC_TASKS: '1',
  OVERWRITE_ORIGINAL: 'false',
  SYNC_LANGUAGES: '',
  SYNC_TIMEOUT: '',
  SYNC_ENGINE_TIMEOUT_MS: '1800000',
  CRON_SCHEDULE: '0 0 * * *',
  AI_BASE_URL: '',
  AI_API_KEY: '',
  AI_MODEL: '',
  AI_TARGET_LANGUAGE: 'Traditional Chinese (Taiwan)',
  AI_OUTPUT_LANGUAGE: 'zh-TW',
  AI_REQUIRED_SUBTITLE_LANGUAGES: '',
  AI_BATCH_CUES: '350',
  AI_BATCH_CHARS: '40000',
  AI_MAX_OUTPUT_TOKENS: '16384',
  AI_TIMEOUT_MS: '300000',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_CHAT_ID: '',
};

let values = { ...APP_SETTING_DEFAULTS };

// Existing container variables are imported only when upgrading an installation
// that has never saved that field in the database. Runtime reads never use env.
export function initializeApplicationSettings(stateManager: StateManager): void {
  const persisted = stateManager.getSettings();
  values = { ...APP_SETTING_DEFAULTS, ...persisted };
  for (const key of Object.keys(APP_SETTING_DEFAULTS)) {
    if (persisted[key] !== undefined) continue;
    const legacyValue = process.env[key];
    values[key] = legacyValue ?? APP_SETTING_DEFAULTS[key];
    stateManager.setSetting(key, values[key]);
  }
}

export function getAppSetting(key: string): string {
  return values[key] ?? APP_SETTING_DEFAULTS[key] ?? '';
}

export function setAppSetting(key: string, value: string): void {
  if (!(key in APP_SETTING_DEFAULTS)) throw new Error(`Unsupported setting: ${key}`);
  values[key] = value;
}
