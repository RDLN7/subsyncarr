import * as fs from 'fs';
import * as path from 'path';

describe('UI Elements Integrity Audit', () => {
  const htmlPath = path.join(__dirname, '../../public/index.html');
  const jsPath = path.join(__dirname, '../../public/app.js');
  const cssPath = path.join(__dirname, '../../public/styles.css');

  let htmlContent: string;
  let jsContent: string;
  let cssContent: string;

  beforeAll(() => {
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
    jsContent = fs.readFileSync(jsPath, 'utf8');
    cssContent = fs.readFileSync(cssPath, 'utf8');
  });

  test('all required HTML element IDs exist in index.html', () => {
    const requiredIds = [
      // Top Nav & Controls
      'themeDark',
      'themeLight',
      'themeSystem',
      'startRun',
      'startCustom',
      'openSettings',
      'stopRun',

      // Metrics Grid
      'statusLabel',
      'statusPaths',
      'scheduleLabel',
      'scheduleTime',
      'aiStatusValue',
      'aiStatusSub',
      'telegramStatusValue',
      'telegramStatusSub',

      // Active Job Panel
      'currentRun',
      'progressText',
      'progressFill',
      'filesInProgress',

      // Completed Section
      'completedSection',
      'completedFilterInput',
      'clearCompleted',
      'completedList',

      // History Section
      'historySection',
      'historyTable',
      'historyBody',

      // Settings Modal & Tabs
      'settingsModal',
      'closeSettingsModal',
      'tab-general',
      'tab-engines',
      'tab-automation',
      'tab-ai',
      'tab-notifications',
      'scanPathsInput',
      'excludePathsInput',
      'engineFfsubsync',
      'engineAutosubsync',
      'engineAlass',
      'engineAiTranslate',
      'maxConcurrentInput',
      'overwriteOriginalInput',
      'cronScheduleInput',
      'aiBaseUrlInput',
      'aiModelInput',
      'aiModelSelect',
      'aiApiKeyInput',
      'toggleAiKey',
      'aiTargetLanguageInput',
      'aiTargetLangSelect',
      'aiOutputLanguageInput',
      'aiOutputLangSelect',
      'aiRequiredLanguagesInput',
      'langSearchInput',
      'langOptionsGrid',
      'langTagsBox',
      'customLangCodeInput',
      'addCustomLangBtn',
      'telegramChatIdInput',
      'telegramTokenInput',
      'toggleTgToken',
      'scheduleSettingsError',
      'cancelSettings',
      'saveSettings',

      // Custom Path Picker Modal
      'customPathModal',
      'closeModal',
      'folderTree',
      'selectedPaths',
      'selectedPathsEmpty',
      'cancelCustom',
      'submitCustom',

      // Logs Modal
      'logsModal',
      'closeLogsModal',
      'logsContent',
      'copyLogs',
      'closeLogsButton',

      // File List Modal
      'fileListModal',
      'fileListTitle',
      'fileListContent',
      'closeFileListModal',
      'closeFileListButton',

      // Toast Container
      'toastContainer',
    ];

    for (const id of requiredIds) {
      expect(htmlContent).toContain(`id="${id}"`);
    }
  });

  test('all required interactive element IDs are bound in app.js', () => {
    const jsBoundIds = [
      'themeDark',
      'themeLight',
      'themeSystem',
      'startRun',
      'startCustom',
      'stopRun',
      'openSettings',
      'closeSettingsModal',
      'cancelSettings',
      'saveSettings',
      'aiModelSelect',
      'aiTargetLangSelect',
      'aiOutputLangSelect',
      'langSearchInput',
      'addCustomLangBtn',
      'closeModal',
      'cancelCustom',
      'submitCustom',
      'copyLogs',
      'closeLogsModal',
      'closeLogsButton',
      'clearCompleted',
      'completedFilterInput',
      'historyBody',
      'toastContainer',
    ];

    for (const id of jsBoundIds) {
      expect(jsContent).toContain(id);
    }
  });

  test('all required design tokens and classes exist in styles.css', () => {
    const requiredCssClasses = [
      '.top-nav',
      '.metrics-grid',
      '.metric-card',
      '.progress-card',
      '.file-card',
      '.data-table',
      '.modal-backdrop',
      '.modal-container',
      '.settings-split-pane',
      '.settings-sidebar',
      '.settings-content-area',
      '.inline-lang-grid',
      '.lang-checkbox-pill',
      '.lang-tags-box',
      '.lang-chip',
      '.results-summary',
      '.stat-tag',
      '.engine-breakdown',
      '.toast-container',
      '.toast',
    ];

    for (const className of requiredCssClasses) {
      expect(cssContent).toContain(className);
    }
  });
});
