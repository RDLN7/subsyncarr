const SUBTITLE_LANGUAGES = [
  { code: 'zh-TW', label: 'Traditional Chinese (zh-TW)', flag: '🇹🇼' },
  { code: 'zh-CN', label: 'Simplified Chinese (zh-CN)', flag: '🇨🇳' },
  { code: 'zh-HK', label: 'Traditional Chinese HK (zh-HK)', flag: '🇭🇰' },
  { code: 'chi', label: 'Chinese Generic (chi)', flag: '🌏' },
  { code: 'eng', label: 'English (eng)', flag: '🇺🇸' },
  { code: 'en', label: 'English (en)', flag: '🇺🇸' },
  { code: 'jpn', label: 'Japanese (jpn)', flag: '🇯🇵' },
  { code: 'ja', label: 'Japanese (ja)', flag: '🇯🇵' },
  { code: 'kor', label: 'Korean (kor)', flag: '🇰🇷' },
  { code: 'ko', label: 'Korean (ko)', flag: '🇰🇷' },
  { code: 'spa', label: 'Spanish (spa)', flag: '🇪🇸' },
  { code: 'es', label: 'Spanish (es)', flag: '🇪🇸' },
  { code: 'fre', label: 'French (fre)', flag: '🇫🇷' },
  { code: 'fr', label: 'French (fr)', flag: '🇫🇷' },
  { code: 'ger', label: 'German (ger)', flag: '🇩🇪' },
  { code: 'de', label: 'German (de)', flag: '🇩🇪' },
  { code: 'ita', label: 'Italian (ita)', flag: '🇮🇹' },
  { code: 'rus', label: 'Russian (rus)', flag: '🇷🇺' },
  { code: 'por', label: 'Portuguese (por)', flag: '🇵🇹' },
  { code: 'vie', label: 'Vietnamese (vie)', flag: '🇻🇳' },
  { code: 'tha', label: 'Thai (tha)', flag: '🇹🇭' },
];

class SubsyncarrPlusClient {
  constructor() {
    this.ws = null;
    this.state = { currentRun: null, files: [], isRunning: false };
    this.reconnectInterval = 3000;
    this.historyCache = {};
    this.selectedPaths = [];
    this.selectedLangCodes = [];
    this.config = null;
    this.activeTheme = localStorage.getItem('subsyncarr_theme') || 'dark';

    this.initTheme();
    this.initWebSocket();
    this.setupEventHandlers();
    this.fetchInitialState();
    this.fetchConfigStatus();
  }

  /* --------------------------------------------------------------------------
     1. Theme Management
     -------------------------------------------------------------------------- */
  initTheme() {
    this.setTheme(this.activeTheme);
  }

  setTheme(theme) {
    this.activeTheme = theme;
    localStorage.setItem('subsyncarr_theme', theme);

    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }

    // Update active UI buttons
    document.querySelectorAll('.theme-btn').forEach((btn) => btn.classList.remove('active'));
    if (theme === 'dark') document.getElementById('themeDark')?.classList.add('active');
    else if (theme === 'light') document.getElementById('themeLight')?.classList.add('active');
    else if (theme === 'system') document.getElementById('themeSystem')?.classList.add('active');
  }

  /* --------------------------------------------------------------------------
     2. Toast Notification Utility
     -------------------------------------------------------------------------- */
  showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 250ms ease';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  /* --------------------------------------------------------------------------
     3. WebSocket & Real-Time Sync
     -------------------------------------------------------------------------- */
  initWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}/ws`);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      const sysText = document.getElementById('sysStatusText');
      if (sysText) sysText.textContent = 'ONLINE';
      const sysPulse = document.querySelector('.sys-pulse');
      if (sysPulse) sysPulse.style.background = 'var(--color-success)';
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this.handleMessage(msg);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting...');
      const sysText = document.getElementById('sysStatusText');
      if (sysText) sysText.textContent = 'RECONNECTING';
      const sysPulse = document.querySelector('.sys-pulse');
      if (sysPulse) sysPulse.style.background = 'var(--color-warning)';
      setTimeout(() => this.initWebSocket(), this.reconnectInterval);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      const sysText = document.getElementById('sysStatusText');
      if (sysText) sysText.textContent = 'LINK ERROR';
      const sysPulse = document.querySelector('.sys-pulse');
      if (sysPulse) sysPulse.style.background = 'var(--color-danger)';
    };
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'state':
        this.state = msg.data;
        this.render();
        break;
      case 'run:started':
        this.state.currentRun = msg.data;
        this.state.isRunning = true;
        this.render();
        this.showToast('Synchronization scan started', 'info');
        break;
      case 'run:completed':
        this.state.currentRun = msg.data;
        this.state.isRunning = false;
        this.render();
        this.fetchHistory();
        this.showToast('Synchronization scan completed', 'success');
        break;
      case 'run:cancelled':
        this.state.currentRun = msg.data;
        this.state.isRunning = false;
        this.render();
        this.fetchHistory();
        this.showToast('Scan stopped by user', 'warning');
        break;
      case 'file:updated':
        this.updateFile(msg.data.file);
        if (msg.data.run) {
          this.state.currentRun = msg.data.run;
        }
        this.render();
        break;
      case 'files:cleared':
        this.state.currentRun = msg.data.currentRun;
        this.state.files = msg.data.files;
        this.render();
        this.showToast('Completed files list cleared', 'info');
        break;
      case 'config:updated':
        this.fetchConfigStatus();
        break;
    }
  }

  updateFile(fileData) {
    const index = this.state.files.findIndex((f) => f.file_path === fileData.file_path);
    if (index >= 0) {
      this.state.files[index] = fileData;
    } else {
      this.state.files.push(fileData);
    }
  }

  /* --------------------------------------------------------------------------
     4. Data Fetching
     -------------------------------------------------------------------------- */
  async fetchInitialState() {
    try {
      const response = await fetch('/api/status');
      const data = await response.json();
      this.state = data;
      this.render();
      this.fetchHistory();
    } catch (err) {
      console.error('Failed to fetch initial status:', err);
    }
  }

  async fetchHistory() {
    try {
      const response = await fetch('/api/history');
      const history = await response.json();

      const historyWithStats = await Promise.all(
        history.map(async (run) => {
          try {
            const filesResponse = await fetch(`/api/runs/${run.id}`);
            const data = await filesResponse.json();
            const runWithFiles = { ...run, files: data.files || [] };
            this.historyCache[run.id] = runWithFiles;
            return runWithFiles;
          } catch (error) {
            console.error(`Failed to fetch files for run ${run.id}:`, error);
            return { ...run, files: [] };
          }
        }),
      );

      this.renderHistory(historyWithStats);
    } catch (err) {
      console.error('Failed to fetch run history:', err);
    }
  }

  async fetchConfigStatus() {
    try {
      const response = await fetch('/api/config');
      const config = await response.json();
      this.config = config;
      this.renderConfigStatus(config);
    } catch (error) {
      console.error('Failed to fetch config status:', error);
      this.renderConfigStatus({ isConfigured: false, paths: [], excludePaths: [] });
    }
  }

  /* --------------------------------------------------------------------------
     5. Render Metrics & Status
     -------------------------------------------------------------------------- */
  renderConfigStatus(config) {
    // Folders Metric
    const label = document.getElementById('statusLabel');
    const paths = document.getElementById('statusPaths');

    if (config.isConfigured) {
      label.innerHTML = `<span class="status-dot active"></span> Monitored (${config.paths.length})`;
      const pathsList = config.paths.join(', ');
      paths.textContent = pathsList;
      paths.title = pathsList;
    } else {
      label.innerHTML = `<span class="status-dot inactive"></span> Unconfigured`;
      paths.textContent = 'Using default: /scan_dir';
    }

    // Schedule Metric
    this.renderScheduleStatus(config.schedule);

    // AI & Telegram Metrics
    this.renderAiConfig(config.aiTranslation, config.telegram);
  }

  renderScheduleStatus(schedule) {
    const scheduleLabel = document.getElementById('scheduleLabel');
    const scheduleTime = document.getElementById('scheduleTime');

    if (schedule && schedule.enabled) {
      scheduleLabel.innerHTML = `<span class="status-dot active"></span> Active Cron`;
      if (schedule.nextRun) {
        const nextRunDate = new Date(schedule.nextRun);
        const timeUntil = this.formatTimeUntil(nextRunDate - new Date());
        scheduleTime.textContent = `${nextRunDate.toLocaleTimeString()} (${timeUntil})`;
      } else {
        scheduleTime.textContent = schedule.description || schedule.cron;
      }
    } else {
      scheduleLabel.innerHTML = `<span class="status-dot inactive"></span> Manual Only`;
      scheduleTime.textContent = 'Disabled';
    }
  }

  renderAiConfig(ai, telegram) {
    const aiVal = document.getElementById('aiStatusValue');
    const aiSub = document.getElementById('aiStatusSub');
    const tgVal = document.getElementById('telegramStatusValue');
    const tgSub = document.getElementById('telegramStatusSub');

    if (aiVal && aiSub) {
      if (ai && ai.enabled) {
        aiVal.innerHTML = `<span class="status-dot ${ai.configured ? 'active' : 'inactive'}"></span> ${ai.configured ? 'Ready' : 'Incomplete'}`;
        aiSub.textContent = `Model: ${ai.model || 'Default'} (${ai.targetLanguage || 'Target unset'})`;
      } else {
        aiVal.innerHTML = `<span class="status-dot inactive"></span> Disabled`;
        aiSub.textContent = 'Engine disabled in settings';
      }
    }

    if (tgVal && tgSub) {
      if (telegram && telegram.configured) {
        tgVal.innerHTML = `<span class="status-dot active"></span> Connected`;
        tgSub.textContent = 'Alerts enabled';
      } else {
        tgVal.innerHTML = `<span class="status-dot inactive"></span> Unset`;
        tgSub.textContent = 'Bot token unconfigured';
      }
    }
  }

  formatTimeUntil(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `in ${days}d`;
    if (hours > 0) return `in ${hours}h`;
    if (minutes > 0) return `in ${minutes}m`;
    return 'soon';
  }

  switchMainView(viewId) {
    document.querySelectorAll('.sidebar-nav .nav-link').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
    });

    const completedSec = document.getElementById('completedSection');
    const historySec = document.getElementById('historySection');
    const terminalSec = document.getElementById('terminalSection');

    if (viewId === 'view-dashboard') {
      completedSec?.classList.remove('hidden');
      historySec?.classList.remove('hidden');
      terminalSec?.classList.add('hidden');
    } else if (viewId === 'view-completed') {
      completedSec?.classList.remove('hidden');
      historySec?.classList.add('hidden');
      terminalSec?.classList.add('hidden');
    } else if (viewId === 'view-history') {
      completedSec?.classList.add('hidden');
      historySec?.classList.remove('hidden');
      terminalSec?.classList.add('hidden');
    } else if (viewId === 'view-terminal') {
      completedSec?.classList.add('hidden');
      historySec?.classList.add('hidden');
      terminalSec?.classList.remove('hidden');
      this.fetchSystemLogsForTerminal();
    }
  }

  async fetchSystemLogsForTerminal() {
    const terminal = document.getElementById('embeddedTerminalContent');
    if (!terminal) return;
    try {
      const response = await fetch('/api/logs');
      const text = await response.text();
      terminal.textContent = text || 'No execution logs available yet.';
      terminal.scrollTop = terminal.scrollHeight;
    } catch (err) {
      terminal.textContent = 'Failed to load execution logs: ' + err.message;
    }
  }

  /* --------------------------------------------------------------------------
     6. Event Handlers & Modal Logic
     -------------------------------------------------------------------------- */
  setupEventHandlers() {
    // Theme Switcher Buttons
    document.getElementById('themeDark')?.addEventListener('click', () => this.setTheme('dark'));
    document.getElementById('themeLight')?.addEventListener('click', () => this.setTheme('light'));
    document.getElementById('themeSystem')?.addEventListener('click', () => this.setTheme('system'));

    // Sidebar View Navigation Switcher
    document.querySelectorAll('.sidebar-nav .nav-link').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const viewId = e.currentTarget.getAttribute('data-view');
        if (viewId) {
          this.switchMainView(viewId);
        } else if (e.currentTarget.id === 'navPreferences') {
          this.openSettings();
        }
      });
    });

    // Global Search Input
    document.getElementById('globalSearchInput')?.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      const filterInput = document.getElementById('completedFilterInput');
      if (filterInput) {
        filterInput.value = query;
        filterInput.dispatchEvent(new Event('input'));
      }
    });

    // Top Controls
    document.getElementById('startRun')?.addEventListener('click', () => this.startRun());
    document.getElementById('startCustom')?.addEventListener('click', () => this.openPicker());
    document.getElementById('stopRun')?.addEventListener('click', () => this.stopRun());
    document.getElementById('openSettings')?.addEventListener('click', () => this.openSettings());

    // Settings Modal Tab Switcher
    document.querySelectorAll('.settings-nav-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const targetTab = e.currentTarget.getAttribute('data-tab');
        this.switchSettingsTab(targetTab);
      });
    });

    // Password Eye Toggles
    this.setupPasswordToggle('aiApiKeyInput', 'toggleAiKey');
    this.setupPasswordToggle('telegramTokenInput', 'toggleTgToken');

    // Settings Actions
    document.getElementById('closeSettingsModal')?.addEventListener('click', () => this.closeSettings());
    document.getElementById('cancelSettings')?.addEventListener('click', () => this.closeSettings());
    document.getElementById('saveSettings')?.addEventListener('click', () => this.saveSettings());
    document.getElementById('settingsModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'settingsModal') this.closeSettings();
    });

    // Custom Path Picker Actions
    document.getElementById('closeModal')?.addEventListener('click', () => this.closePicker());
    document.getElementById('cancelCustom')?.addEventListener('click', () => this.closePicker());
    document.getElementById('submitCustom')?.addEventListener('click', () => {
      if (this.selectedPaths.length === 0) {
        alert('Please add at least one folder path before starting scan.');
        return;
      }
      const paths = this.selectedPaths.slice();
      this.closePicker();
      this.startRun(paths);
    });
    document.getElementById('customPathModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'customPathModal') this.closePicker();
    });

    // Logs Modal Handlers
    document.getElementById('closeLogsModal')?.addEventListener('click', () => {
      document.getElementById('logsModal').classList.add('hidden');
    });
    document.getElementById('closeLogsButton')?.addEventListener('click', () => {
      document.getElementById('logsModal').classList.add('hidden');
    });
    document.getElementById('copyLogs')?.addEventListener('click', () => this.copyLogsToClipboard());
    document.getElementById('logsModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'logsModal') document.getElementById('logsModal').classList.add('hidden');
    });

    // File List Modal Handlers
    document.getElementById('closeFileListModal')?.addEventListener('click', () => {
      document.getElementById('fileListModal').classList.add('hidden');
    });
    document.getElementById('closeFileListButton')?.addEventListener('click', () => {
      document.getElementById('fileListModal').classList.add('hidden');
    });
    document.getElementById('fileListModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'fileListModal') document.getElementById('fileListModal').classList.add('hidden');
    });

    // Preset select dropdown listeners
    document.getElementById('aiModelSelect')?.addEventListener('change', (e) => {
      const target = e.target;
      if (target.value) document.getElementById('aiModelInput').value = target.value;
    });

    document.getElementById('aiTargetLangSelect')?.addEventListener('change', (e) => {
      const target = e.target;
      if (target.value) document.getElementById('aiTargetLanguageInput').value = target.value;
    });

    document.getElementById('aiOutputLangSelect')?.addEventListener('change', (e) => {
      const target = e.target;
      if (target.value) document.getElementById('aiOutputLanguageInput').value = target.value;
    });

    // Language Picker Popup Toggles
    document.getElementById('toggleLangMenuBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const popup = document.getElementById('langPopupMenu');
      popup?.classList.toggle('hidden');
    });

    document.getElementById('closeLangMenuBtn')?.addEventListener('click', () => {
      document.getElementById('langPopupMenu')?.classList.add('hidden');
    });

    // Preset Pill Buttons
    document.querySelectorAll('.preset-pill-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const preset = e.currentTarget.getAttribute('data-preset');
        if (preset === 'clear') {
          this.selectedLangCodes = [];
        } else if (preset) {
          const codes = preset
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean);
          codes.forEach((c) => {
            if (!this.selectedLangCodes.includes(c)) this.selectedLangCodes.push(c);
          });
        }
        this.renderLangChips();
        this.renderLangPopupOptions();
      });
    });

    // Language Search Filter
    document.getElementById('langSearchInput')?.addEventListener('input', (e) => {
      const target = e.target;
      this.renderLangPopupOptions(target.value.toLowerCase().trim());
    });

    // Schedule Frequency Selector Listeners
    document.getElementById('scheduleFrequencySelect')?.addEventListener('change', (e) => {
      const val = e.target.value;
      const dailyRow = document.getElementById('dailyTimeRow');
      const weeklyRow = document.getElementById('weeklyRow');
      const customRow = document.getElementById('customCronRow');
      const cronInput = document.getElementById('cronScheduleInput');

      dailyRow?.classList.add('hidden');
      weeklyRow?.classList.add('hidden');
      customRow?.classList.add('hidden');

      if (val === 'daily') {
        dailyRow?.classList.remove('hidden');
        const hour = document.getElementById('dailyTimeSelect')?.value || '3';
        cronInput.value = `0 ${hour} * * *`;
      } else if (val === 'weekly') {
        weeklyRow?.classList.remove('hidden');
        const day = document.getElementById('weeklyDaySelect')?.value || '0';
        const hour = document.getElementById('weeklyTimeSelect')?.value || '3';
        cronInput.value = `0 ${hour} * * ${day}`;
      } else if (val === 'custom') {
        customRow?.classList.remove('hidden');
      } else {
        cronInput.value = val;
      }
      this.updateCronHumanDisplay();
    });

    document.getElementById('dailyTimeSelect')?.addEventListener('change', (e) => {
      const cronInput = document.getElementById('cronScheduleInput');
      if (cronInput) cronInput.value = `0 ${e.target.value} * * *`;
      this.updateCronHumanDisplay();
    });

    document.getElementById('weeklyDaySelect')?.addEventListener('change', () => {
      const cronInput = document.getElementById('cronScheduleInput');
      const day = document.getElementById('weeklyDaySelect')?.value || '0';
      const hour = document.getElementById('weeklyTimeSelect')?.value || '3';
      if (cronInput) cronInput.value = `0 ${hour} * * ${day}`;
      this.updateCronHumanDisplay();
    });

    document.getElementById('weeklyTimeSelect')?.addEventListener('change', () => {
      const cronInput = document.getElementById('cronScheduleInput');
      const day = document.getElementById('weeklyDaySelect')?.value || '0';
      const hour = document.getElementById('weeklyTimeSelect')?.value || '3';
      if (cronInput) cronInput.value = `0 ${hour} * * ${day}`;
      this.updateCronHumanDisplay();
    });

    document.getElementById('cronScheduleInput')?.addEventListener('input', () => {
      this.updateCronHumanDisplay();
    });

    // Add Custom Code
    document.getElementById('addCustomLangBtn')?.addEventListener('click', () => {
      const customInput = document.getElementById('customLangCodeInput');
      const val = customInput.value.trim();
      if (val && !this.selectedLangCodes.includes(val)) {
        this.selectedLangCodes.push(val);
        customInput.value = '';
        this.renderLangChips();
        this.renderLangPopupOptions();
      }
    });

    // Close popup on outside click
    document.addEventListener('click', (e) => {
      const popup = document.getElementById('langPopupMenu');
      const toggleBtn = document.getElementById('toggleLangMenuBtn');
      if (popup && !popup.classList.contains('hidden') && !popup.contains(e.target) && e.target !== toggleBtn) {
        popup.classList.add('hidden');
      }
    });

    // Clear Completed Action
    document.getElementById('clearCompleted')?.addEventListener('click', () => this.clearCompleted());

    // Completed Files Live Search Filter
    document.getElementById('completedFilterInput')?.addEventListener('input', (e) => {
      const target = e.target;
      this.filterCompletedFiles(target.value.toLowerCase().trim());
    });

    // History Table Event Delegation
    document.getElementById('historyBody')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action="view-logs"]');
      if (btn) {
        const runId = btn.getAttribute('data-run-id');
        if (runId) this.viewLogs(runId);
        return;
      }
      const tag = e.target.closest('.stat-tag[data-action="show-files"]');
      if (tag) {
        const runId = tag.getAttribute('data-run-id');
        const category = tag.getAttribute('data-category');
        if (runId && category) this.showFileList(runId, category);
      }
    });
  }

  renderLangChips() {
    const box = document.getElementById('langTagsBox');
    const hiddenInput = document.getElementById('aiRequiredLanguagesInput');
    if (!box || !hiddenInput) return;

    box.innerHTML = '';
    hiddenInput.value = this.selectedLangCodes.join(', ');

    if (this.selectedLangCodes.length === 0) {
      box.innerHTML =
        '<span class="text-muted" style="font-size:13px;">No monitored languages selected (Always translate). Select options above to add.</span>';
      return;
    }

    this.selectedLangCodes.forEach((code) => {
      const catalogItem = SUBTITLE_LANGUAGES.find((item) => item.code === code);
      const label = catalogItem ? `${catalogItem.flag} ${catalogItem.code}` : code;

      const chip = document.createElement('div');
      chip.className = 'lang-chip';
      chip.innerHTML = `<span>${this.escapeHtml(label)}</span><span class="lang-chip-remove" title="Remove">&times;</span>`;
      chip.querySelector('.lang-chip-remove').addEventListener('click', () => {
        this.selectedLangCodes = this.selectedLangCodes.filter((c) => c !== code);
        this.renderLangChips();
        this.renderLangPopupOptions();
      });
      box.appendChild(chip);
    });
  }

  renderLangPopupOptions(filterQuery = '') {
    const grid = document.getElementById('langOptionsGrid');
    if (!grid) return;

    grid.innerHTML = '';
    const filtered = SUBTITLE_LANGUAGES.filter(
      (item) => item.code.toLowerCase().includes(filterQuery) || item.label.toLowerCase().includes(filterQuery),
    );

    if (filtered.length === 0) {
      grid.innerHTML =
        '<span class="text-muted" style="font-size:12px; grid-column:1/-1;">No matching languages found. Add custom code below.</span>';
      return;
    }

    filtered.forEach((item) => {
      const isChecked = this.selectedLangCodes.includes(item.code);
      const labelEl = document.createElement('label');
      labelEl.className = 'lang-checkbox-pill';
      labelEl.innerHTML = `
        <input type="checkbox" value="${this.escapeHtml(item.code)}" ${isChecked ? 'checked' : ''} />
        <span>${item.flag} ${this.escapeHtml(item.label)}</span>
      `;
      labelEl.querySelector('input').addEventListener('change', (e) => {
        const input = e.target;
        if (input.checked) {
          if (!this.selectedLangCodes.includes(item.code)) this.selectedLangCodes.push(item.code);
        } else {
          this.selectedLangCodes = this.selectedLangCodes.filter((c) => c !== item.code);
        }
        this.renderLangChips();
      });
      grid.appendChild(labelEl);
    });
  }

  setupPasswordToggle(inputId, btnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    if (!input || !btn) return;

    btn.addEventListener('click', () => {
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      btn.textContent = isPass ? '🔒' : '👁️';
    });
  }

  switchSettingsTab(tabId) {
    document.querySelectorAll('.settings-nav-item').forEach((item) => {
      item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.settings-tab-pane').forEach((pane) => {
      pane.classList.toggle('hidden', pane.id !== tabId);
    });
  }

  openSettings() {
    const settings = this.config?.settings || {};
    const ai = settings.ai || {};
    const telegram = settings.telegram || {};

    document.getElementById('scanPathsInput').value = settings.scanPaths || '';
    document.getElementById('excludePathsInput').value = settings.excludePaths || '';
    document.getElementById('maxConcurrentInput').value = settings.maxConcurrentTasks || '1';
    document.getElementById('overwriteOriginalInput').checked = Boolean(settings.overwriteOriginal);

    for (const engine of ['ffsubsync', 'autosubsync', 'alass', 'ai-translate']) {
      const id = `engine${engine === 'ai-translate' ? 'AiTranslate' : engine[0].toUpperCase() + engine.slice(1)}`;
      const el = document.getElementById(id);
      if (el) el.checked = (settings.engines || []).includes(engine);
    }

    document.getElementById('cronScheduleInput').value = this.config?.schedule?.cron || '0 0 * * *';
    document.getElementById('aiBaseUrlInput').value = ai.baseUrl || '';
    document.getElementById('aiModelInput').value = ai.model || '';
    document.getElementById('aiApiKeyInput').value = '';
    document.getElementById('aiTargetLanguageInput').value = ai.targetLanguage || '';
    document.getElementById('aiOutputLanguageInput').value = ai.outputLanguage || '';
    document.getElementById('telegramChatIdInput').value = telegram.chatId || '';
    document.getElementById('telegramTokenInput').value = '';

    const rawReqLangs = ai.requiredSubtitleLanguages || '';
    this.selectedLangCodes = rawReqLangs
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.renderLangChips();
    this.renderLangPopupOptions();

    this.initScheduleUIFromCron(this.config?.schedule?.cron || '0 0 * * *');

    document.getElementById('scheduleSettingsError').classList.add('hidden');
    this.switchSettingsTab('tab-general');
    document.getElementById('settingsModal').classList.remove('hidden');
  }

  formatCronHuman(cronStr) {
    if (!cronStr || cronStr.trim().toLowerCase() === 'disabled') {
      return { title: 'Disabled — Manual scans only', sub: 'Automated background scanning is turned off' };
    }

    const clean = cronStr.trim();
    if (clean === '0 * * * *') {
      return { title: 'Runs automatically every hour at :00', sub: `Cron Expression: ${clean}` };
    }
    if (clean === '0 */2 * * *') {
      return { title: 'Runs automatically every 2 hours', sub: `Cron Expression: ${clean}` };
    }
    if (clean === '0 */3 * * *') {
      return { title: 'Runs automatically every 3 hours', sub: `Cron Expression: ${clean}` };
    }
    if (clean === '0 */4 * * *') {
      return { title: 'Runs automatically every 4 hours', sub: `Cron Expression: ${clean}` };
    }
    if (clean === '0 */6 * * *') {
      return { title: 'Runs automatically every 6 hours', sub: `Cron Expression: ${clean}` };
    }
    if (clean === '0 */12 * * *') {
      return { title: 'Runs automatically every 12 hours', sub: `Cron Expression: ${clean}` };
    }
    if (clean === '0 0 * * *') {
      return { title: 'Runs automatically every day at Midnight (12:00 AM)', sub: `Cron Expression: ${clean}` };
    }

    const dailyMatch = clean.match(/^0\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
    if (dailyMatch) {
      const h = parseInt(dailyMatch[1], 10);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayH = h % 12 === 0 ? 12 : h % 12;
      return { title: `Runs automatically every day at ${displayH}:00 ${ampm}`, sub: `Cron Expression: ${clean}` };
    }

    const weeklyMatch = clean.match(/^0\s+(\d{1,2})\s+\*\s+\*\s+(\d)$/);
    if (weeklyMatch) {
      const h = parseInt(weeklyMatch[1], 10);
      const dayNum = parseInt(weeklyMatch[2], 10);
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayH = h % 12 === 0 ? 12 : h % 12;
      return {
        title: `Runs automatically every ${days[dayNum] || 'week'} at ${displayH}:00 ${ampm}`,
        sub: `Cron Expression: ${clean}`,
      };
    }

    return { title: `Custom Schedule: ${clean}`, sub: `Active cron expression: ${clean}` };
  }

  updateCronHumanDisplay() {
    const cronInput = document.getElementById('cronScheduleInput');
    const titleEl = document.getElementById('cronHumanTitle');
    const subEl = document.getElementById('cronHumanSub');
    if (!cronInput || !titleEl || !subEl) return;

    const info = this.formatCronHuman(cronInput.value);
    titleEl.textContent = info.title;
    subEl.innerHTML = info.sub.startsWith('Cron Expression:')
      ? `Cron Expression: <code>${this.escapeHtml(cronInput.value.trim())}</code>`
      : this.escapeHtml(info.sub);
  }

  initScheduleUIFromCron(cronStr) {
    const freqSelect = document.getElementById('scheduleFrequencySelect');
    const dailyRow = document.getElementById('dailyTimeRow');
    const weeklyRow = document.getElementById('weeklyRow');
    const customRow = document.getElementById('customCronRow');
    const cronInput = document.getElementById('cronScheduleInput');

    if (!freqSelect || !cronInput) return;

    cronInput.value = cronStr || '0 0 * * *';
    const clean = cronInput.value.trim();

    dailyRow?.classList.add('hidden');
    weeklyRow?.classList.add('hidden');
    customRow?.classList.add('hidden');

    const standardPreset = [
      'disabled',
      '0 * * * *',
      '0 */2 * * *',
      '0 */3 * * *',
      '0 */4 * * *',
      '0 */6 * * *',
      '0 */12 * * *',
    ].find((p) => p === clean);
    if (standardPreset) {
      freqSelect.value = standardPreset;
    } else {
      const dailyMatch = clean.match(/^0\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
      if (dailyMatch) {
        freqSelect.value = 'daily';
        dailyRow?.classList.remove('hidden');
        const dailySelect = document.getElementById('dailyTimeSelect');
        if (dailySelect) dailySelect.value = dailyMatch[1];
      } else {
        const weeklyMatch = clean.match(/^0\s+(\d{1,2})\s+\*\s+\*\s+(\d)$/);
        if (weeklyMatch) {
          freqSelect.value = 'weekly';
          weeklyRow?.classList.remove('hidden');
          const weeklyTimeSelect = document.getElementById('weeklyTimeSelect');
          const weeklyDaySelect = document.getElementById('weeklyDaySelect');
          if (weeklyTimeSelect) weeklyTimeSelect.value = weeklyMatch[1];
          if (weeklyDaySelect) weeklyDaySelect.value = weeklyMatch[2];
        } else {
          freqSelect.value = 'custom';
          customRow?.classList.remove('hidden');
        }
      }
    }
    this.updateCronHumanDisplay();
  }

  closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
  }

  async saveSettings() {
    const cron = document.getElementById('cronScheduleInput').value.trim();
    const error = document.getElementById('scheduleSettingsError');
    error.classList.add('hidden');

    try {
      const selectedEngines = ['ffsubsync', 'autosubsync', 'alass', 'ai-translate'].filter((engine) => {
        const id = `engine${engine === 'ai-translate' ? 'AiTranslate' : engine[0].toUpperCase() + engine.slice(1)}`;
        return document.getElementById(id).checked;
      });

      if (!selectedEngines.length) throw new Error('Select at least one processing engine');

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          SCAN_PATHS: document.getElementById('scanPathsInput').value,
          EXCLUDE_PATHS: document.getElementById('excludePathsInput').value,
          INCLUDE_ENGINES: selectedEngines.join(','),
          MAX_CONCURRENT_SYNC_TASKS: document.getElementById('maxConcurrentInput').value,
          OVERWRITE_ORIGINAL: String(document.getElementById('overwriteOriginalInput').checked),
          AI_BASE_URL: document.getElementById('aiBaseUrlInput').value,
          AI_MODEL: document.getElementById('aiModelInput').value,
          AI_API_KEY: document.getElementById('aiApiKeyInput').value,
          AI_TARGET_LANGUAGE: document.getElementById('aiTargetLanguageInput').value,
          AI_OUTPUT_LANGUAGE: document.getElementById('aiOutputLanguageInput').value,
          AI_REQUIRED_SUBTITLE_LANGUAGES: document.getElementById('aiRequiredLanguagesInput').value,
          TELEGRAM_CHAT_ID: document.getElementById('telegramChatIdInput').value,
          TELEGRAM_BOT_TOKEN: document.getElementById('telegramTokenInput').value,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save settings');

      const scheduleResponse = await fetch('/api/settings/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cron }),
      });

      const scheduleData = await scheduleResponse.json();
      if (!scheduleResponse.ok) throw new Error(scheduleData.error || 'Could not save schedule');

      this.closeSettings();
      await this.fetchConfigStatus();
      this.showToast('Preferences updated successfully', 'success');
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : 'Failed to save settings';
      error.classList.remove('hidden');
    }
  }

  /* --------------------------------------------------------------------------
     7. Folder Tree Directory Browser
     -------------------------------------------------------------------------- */
  async openPicker() {
    this.selectedPaths = [];
    this.renderSelectedPaths();
    const tree = document.getElementById('folderTree');
    tree.innerHTML = '<div class="text-muted" style="padding:12px;">Loading directory tree…</div>';
    document.getElementById('customPathModal').classList.remove('hidden');

    try {
      const data = await this.fetchBrowse(null);
      tree.innerHTML = '';
      if (data.entries.length === 0) {
        tree.innerHTML = '<div class="text-muted">No paths configured. Set SCAN_PATHS env var.</div>';
        return;
      }
      data.entries.forEach((entry) => tree.appendChild(this.makeTreeRow(entry, 0)));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      tree.innerHTML = `<div class="text-danger">Failed to load paths: ${this.escapeHtml(errMsg)}</div>`;
    }
  }

  closePicker() {
    document.getElementById('customPathModal').classList.add('hidden');
  }

  async fetchBrowse(path) {
    const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  makeTreeRow(entry, depth) {
    const wrapper = document.createElement('div');
    const isFile = entry.isDir === false;

    const row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = `${depth * 16 + 8}px`;

    const chevron = document.createElement('span');
    chevron.className = 'tree-chevron';
    chevron.textContent = isFile ? '' : '▶';

    const icon = document.createElement('span');
    icon.textContent = isFile ? '📄 ' : '📁 ';

    const name = document.createElement('span');
    name.style.flex = '1';
    name.textContent = entry.name;
    name.title = entry.path;

    row.appendChild(chevron);
    row.appendChild(icon);
    row.appendChild(name);

    if (isFile) {
      wrapper.appendChild(row);
      return wrapper;
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'tree-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add this folder';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.addSelectedPath(entry.path);
    });
    row.appendChild(addBtn);

    const children = document.createElement('div');
    children.className = 'hidden';
    let loaded = false;

    const toggle = async () => {
      if (!loaded) {
        loaded = true;
        children.innerHTML = `<div style="padding-left:${(depth + 1) * 16}px" class="text-muted">Loading…</div>`;
        children.classList.remove('hidden');
        chevron.textContent = '▼';
        try {
          const data = await this.fetchBrowse(entry.path);
          children.innerHTML = '';
          if (data.entries.length === 0) {
            const empty = document.createElement('div');
            empty.style.paddingLeft = `${(depth + 1) * 16}px`;
            empty.className = 'text-muted';
            empty.textContent = '(empty)';
            children.appendChild(empty);
          } else {
            data.entries.forEach((child) => children.appendChild(this.makeTreeRow(child, depth + 1)));
          }
        } catch {
          children.innerHTML = `<div style="padding-left:${(depth + 1) * 16}px" class="text-danger">Failed to load</div>`;
        }
        return;
      }
      const willOpen = children.classList.contains('hidden');
      children.classList.toggle('hidden');
      chevron.textContent = willOpen ? '▼' : '▶';
    };

    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });
    name.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });

    wrapper.appendChild(row);
    wrapper.appendChild(children);
    return wrapper;
  }

  addSelectedPath(path) {
    if (this.selectedPaths.includes(path)) return;
    this.selectedPaths.push(path);
    this.renderSelectedPaths();
  }

  removeSelectedPath(path) {
    this.selectedPaths = this.selectedPaths.filter((p) => p !== path);
    this.renderSelectedPaths();
  }

  renderSelectedPaths() {
    const list = document.getElementById('selectedPaths');
    const empty = document.getElementById('selectedPathsEmpty');
    list.innerHTML = '';

    if (this.selectedPaths.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    this.selectedPaths.forEach((path) => {
      const tag = document.createElement('div');
      tag.className = 'selected-tag';
      tag.innerHTML = `<span>${this.escapeHtml(path)}</span><span class="selected-tag-remove" title="Remove">&times;</span>`;
      tag.querySelector('.selected-tag-remove').addEventListener('click', () => this.removeSelectedPath(path));
      list.appendChild(tag);
    });
  }

  /* --------------------------------------------------------------------------
     8. Execution Commands
     -------------------------------------------------------------------------- */
  async startRun(paths = null) {
    try {
      const response = await fetch('/api/run/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });

      if (!response.ok) {
        const error = await response.json();
        this.showToast(`Failed to start run: ${error.error}`, 'error');
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.showToast(`Failed to start run: ${errMsg}`, 'error');
    }
  }

  async stopRun() {
    if (!confirm('Are you sure you want to stop the current run? All active processing will halt.')) {
      return;
    }

    try {
      const response = await fetch('/api/run/stop', { method: 'POST' });
      if (!response.ok) {
        const error = await response.json();
        this.showToast(`Failed to stop run: ${error.error}`, 'error');
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.showToast(`Failed to stop run: ${errMsg}`, 'error');
    }
  }

  async skipFile(filePath) {
    try {
      await fetch('/api/file/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
      this.showToast(`Skipped file: ${this.basename(filePath)}`, 'info');
    } catch (error) {
      console.error('Failed to skip file:', error);
    }
  }

  async viewLogs(runId) {
    const modal = document.getElementById('logsModal');
    const content = document.getElementById('logsContent');
    if (!modal || !content) return;

    content.textContent = 'Loading execution logs...';
    modal.classList.remove('hidden');

    try {
      const response = await fetch(`/api/runs/${runId}/logs`);
      const data = await response.json();
      content.textContent = data.logs || data.error || 'No logs available for this run.';
    } catch (err) {
      console.error('Failed to load logs:', err);
      content.textContent = 'Failed to fetch logs from server.';
      this.showToast('Failed to load logs', 'error');
    }
  }

  async copyLogsToClipboard() {
    const logsContent = document.getElementById('logsContent').textContent;
    try {
      await navigator.clipboard.writeText(logsContent);
      this.showToast('Logs copied to clipboard', 'success');
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = logsContent;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        this.showToast('Logs copied to clipboard', 'success');
      } catch {
        this.showToast('Failed to copy logs', 'error');
      }
      document.body.removeChild(textArea);
    }
  }

  async clearCompleted() {
    if (!confirm('Clear all finished files from the active list?')) return;
    try {
      const response = await fetch('/api/files/clear', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to clear files');
    } catch {
      this.showToast('Failed to clear files', 'error');
    }
  }

  /* --------------------------------------------------------------------------
     9. UI Rendering Loops
     -------------------------------------------------------------------------- */
  render() {
    this.renderProgress();
    this.renderFiles();
    this.updateButtonVisibility();
  }

  updateButtonVisibility() {
    const stopBtn = document.getElementById('stopRun');
    const startBtn = document.getElementById('startRun');
    const customBtn = document.getElementById('startCustom');

    if (this.state.isRunning) {
      stopBtn?.classList.remove('hidden');
      startBtn?.classList.add('hidden');
      customBtn?.classList.add('hidden');
    } else {
      stopBtn?.classList.add('hidden');
      startBtn?.classList.remove('hidden');
      customBtn?.classList.remove('hidden');
    }
  }

  renderProgress() {
    const { currentRun } = this.state;
    const section = document.getElementById('currentRun');

    if (!currentRun || currentRun.status === 'completed') {
      section?.classList.add('hidden');
      return;
    }

    section?.classList.remove('hidden');
    const percent = currentRun.total_engines > 0 ? (currentRun.completed_engines / currentRun.total_engines) * 100 : 0;

    const fill = document.getElementById('progressFill');
    const text = document.getElementById('progressText');
    if (fill) fill.style.width = `${percent}%`;
    if (text) text.textContent = `${currentRun.completed} / ${currentRun.total_files} files (${Math.round(percent)}%)`;
  }

  renderFiles() {
    const processing = this.state.files.filter((f) => f.status === 'processing');
    const completed = this.state.files.filter((f) => ['completed', 'skipped', 'error'].includes(f.status));

    // Processing Files
    const progressHtml = processing
      .map((file) => {
        const engines = JSON.parse(file.engines);
        return `
        <div class="file-card">
          <div class="file-card-top" style="display:flex; justify-content:space-between; align-items:center;">
            <span class="file-card-name">${this.escapeHtml(this.basename(file.file_path))}</span>
            <div style="display:flex; gap: 6px; align-items:center; flex-shrink:0;">
              <button type="button" class="btn btn-warning btn-sm" onclick="client.skipFile(${this.escapeHtml(JSON.stringify(file.file_path))})" title="Skip this file and move to next">
                Skip
              </button>
              <button type="button" class="btn btn-danger btn-sm" onclick="client.stopRun()" title="Stop entire sync process">
                Stop Process
              </button>
            </div>
          </div>
          <div class="file-card-engine">
            ⚙️ ${file.current_engine ? `Engine: ${file.current_engine}` : 'Initializing...'}
          </div>
          ${this.renderEngineResults(engines)}
        </div>
      `;
      })
      .join('');

    const targetProg = document.getElementById('filesInProgress');
    if (targetProg) targetProg.innerHTML = progressHtml;

    // Completed Files
    const completedHtml = completed
      .map((file) => {
        const engines = JSON.parse(file.engines);
        return `
        <div class="file-card">
          <div class="file-card-top">
            <span class="file-card-name">${this.escapeHtml(this.cleanFileName(file.file_path))}</span>
            <span class="badge badge-${file.status}">${file.status}</span>
          </div>
          ${this.renderEngineResults(engines)}
        </div>
      `;
      })
      .join('');

    const targetComp = document.getElementById('completedList');
    if (targetComp) {
      targetComp.innerHTML =
        completedHtml || '<p class="text-muted" style="padding:12px;">No recently finished files.</p>';
    }
  }

  filterCompletedFiles(query) {
    const cards = document.querySelectorAll('#completedList .file-card');
    cards.forEach((card) => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(query) ? '' : 'none';
    });
  }

  renderEngineResults(engines) {
    return `
      <div class="engine-chips">
        ${Object.entries(engines)
          .map(([name, result]) => {
            const className = result.success ? 'success' : 'error';
            const icon = result.success ? '✓' : '✗';
            const duration = (result.duration / 1000).toFixed(1);
            return `<span class="engine-chip ${className}">${icon} ${name}: ${duration}s</span>`;
          })
          .join('')}
      </div>
    `;
  }

  calculateEngineStats(files) {
    const stats = {
      ffsubsync: { pass: 0, fail: 0 },
      autosubsync: { pass: 0, fail: 0 },
      alass: { pass: 0, fail: 0 },
      'ai-translate': { pass: 0, fail: 0 },
    };

    files.forEach((file) => {
      try {
        const engines = JSON.parse(file.engines);
        Object.entries(engines).forEach(([engineName, result]) => {
          if (stats[engineName]) {
            if (result.success) stats[engineName].pass++;
            else stats[engineName].fail++;
          }
        });
      } catch (error) {
        console.error('Error parsing engine data:', error);
      }
    });

    return stats;
  }

  formatDuration(seconds) {
    if (!seconds || isNaN(seconds) || seconds <= 0) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);

    return parts.join(' ');
  }

  formatFriendlyDate(timestamp) {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return String(timestamp);

    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

    if (isToday) return `Today at ${timeStr}`;
    if (isYesterday) return `Yesterday at ${timeStr}`;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  }

  renderEngineBreakdown(engineStats) {
    const engineNames = {
      ffsubsync: 'FFsubsync',
      autosubsync: 'Autosubsync',
      alass: 'Alass',
      'ai-translate': 'AI Translation',
    };

    const badges = [];
    Object.entries(engineStats).forEach(([key, stats]) => {
      if (stats.pass > 0 || stats.fail > 0) {
        const name = engineNames[key] || key;
        const passText = stats.pass > 0 ? `<span class="engine-badge-pass">${stats.pass} ok</span>` : '';
        const failText = stats.fail > 0 ? `<span class="engine-badge-fail">${stats.fail} failed</span>` : '';
        badges.push(`<span class="engine-badge">${name}: ${[passText, failText].filter(Boolean).join(', ')}</span>`);
      }
    });

    if (badges.length === 0) return '<span class="text-muted">-</span>';
    return `<div class="engine-breakdown">${badges.join('')}</div>`;
  }

  renderHistory(runs) {
    const html = runs
      .map((run) => {
        const durationSec = run.end_time ? Math.round((run.end_time - run.start_time) / 1000) : 0;
        const durationText = run.end_time ? this.formatDuration(durationSec) : 'In progress...';
        const engineStats = this.calculateEngineStats(run.files || []);

        const outcomes = [];
        if (run.completed > 0) {
          outcomes.push(
            `<span class="stat-tag success" style="cursor:pointer;" title="Click to view completed files" data-action="show-files" data-run-id="${run.id}" data-category="completed" onclick="window.client && window.client.showFileList('${run.id}', 'completed')">✓ ${run.completed} Synced</span>`,
          );
        }
        if (run.skipped > 0) {
          outcomes.push(
            `<span class="stat-tag warning" style="cursor:pointer;" title="Click to view skipped files" data-action="show-files" data-run-id="${run.id}" data-category="skipped" onclick="window.client && window.client.showFileList('${run.id}', 'skipped')">⊘ ${run.skipped} Skipped</span>`,
          );
        }
        if (run.failed > 0) {
          outcomes.push(
            `<span class="stat-tag danger" style="cursor:pointer;" title="Click to view failed files" data-action="show-files" data-run-id="${run.id}" data-category="failed" onclick="window.client && window.client.showFileList('${run.id}', 'failed')">✕ ${run.failed} Failed</span>`,
          );
        }
        if (outcomes.length === 0) {
          outcomes.push('<span class="text-muted">No actions</span>');
        }

        const dateStr = this.formatFriendlyDate(run.start_time);

        return `
        <tr>
          <td><strong>${dateStr}</strong></td>
          <td><span class="badge badge-${run.status}">${run.status}</span></td>
          <td><strong>${run.total_files || 0}</strong> files</td>
          <td><div class="results-summary">${outcomes.join('')}</div></td>
          <td>${this.renderEngineBreakdown(engineStats)}</td>
          <td>${durationText}</td>
          <td>
            <button class="btn btn-secondary btn-sm" data-action="view-logs" data-run-id="${run.id}" onclick="window.client && window.client.viewLogs('${run.id}')">
              📄 View Logs
            </button>
          </td>
        </tr>
      `;
      })
      .join('');

    const targetHistory = document.getElementById('historyBody');
    if (targetHistory) {
      targetHistory.innerHTML =
        html ||
        '<tr><td colspan="7" class="text-muted" style="text-align:center; padding:16px;">No scan history recorded yet.</td></tr>';
    }
  }

  async showFileList(runId, category) {
    let run = this.historyCache[runId];
    if (!run || !run.files || run.files.length === 0) {
      try {
        const response = await fetch(`/api/runs/${runId}`);
        if (response.ok) {
          const data = await response.json();
          run = { ...(data.run || run || { id: runId }), files: data.files || [] };
          this.historyCache[runId] = run;
        }
      } catch (err) {
        console.error(`Failed to fetch run details for ${runId}:`, err);
      }
    }

    if (!run || !run.files) {
      this.showToast('File details unavailable for this run', 'error');
      return;
    }

    let files = [];
    let title = '';

    switch (category) {
      case 'completed':
        files = run.files.filter((f) => f.status === 'completed');
        title = `Synced Movies (${files.length})`;
        break;
      case 'skipped':
        files = run.files.filter((f) => f.status === 'skipped');
        title = `Skipped Movies (${files.length})`;
        break;
      case 'failed':
        files = run.files.filter((f) => f.status === 'error');
        title = `Failed Movies (${files.length})`;
        break;
      default:
        return;
    }

    document.getElementById('fileListTitle').textContent = title;
    const content = document.getElementById('fileListContent');

    if (files.length === 0) {
      content.innerHTML =
        '<div class="text-muted" style="padding:16px; text-align:center;">No movies in this list.</div>';
    } else if (category === 'failed') {
      content.innerHTML = files
        .map((file) => {
          const movieName = this.extractMovieName(file.file_path);
          let engines = {};
          try {
            engines = JSON.parse(file.engines || '{}');
          } catch {
            /* ignore */
          }

          const errorEntries = Object.entries(engines)
            .filter(([, result]) => result && result.success === false && !result.skipped)
            .map(([engine, result]) => {
              const msg = result.message || 'Unknown error occurred';
              return `<div style="margin-top:6px; font-size:12px; font-family:monospace; background:rgba(0,0,0,0.3); padding:8px 12px; border-radius:6px; color:#f87171; border-left:3px solid var(--color-danger); white-space:pre-wrap; word-break:break-word;"><strong>⚙️ ${this.escapeHtml(engine)}:</strong> ${this.escapeHtml(msg)}</div>`;
            })
            .join('');

          const fallbackError = !errorEntries
            ? `<div style="margin-top:6px; font-size:12px; font-family:monospace; background:rgba(0,0,0,0.3); padding:8px 12px; border-radius:6px; color:#f87171; border-left:3px solid var(--color-danger);">⚠️ Processing failed for this file</div>`
            : errorEntries;

          return `
            <div class="file-card" style="display:flex; flex-direction:column; gap:4px; padding:12px 16px; border:1px solid rgba(239, 68, 68, 0.2); background:rgba(239, 68, 68, 0.03);">
              <div style="font-weight:600; font-size:14px; color:var(--color-text-main); display:flex; align-items:center; gap:8px;">
                <span>🎬</span> ${this.escapeHtml(movieName)}
              </div>
              ${fallbackError}
            </div>
          `;
        })
        .join('');
    } else {
      content.innerHTML = files
        .map((file) => {
          const movieName = this.extractMovieName(file.file_path);
          let engines = {};
          try {
            engines = JSON.parse(file.engines || '{}');
          } catch {
            /* ignore */
          }

          let offsetBadge = '';
          const offsetEntry = Object.entries(engines).find(
            ([, res]) => res && res.offset && typeof res.offset === 'string',
          );

          if (offsetEntry && offsetEntry[1] && offsetEntry[1].offset) {
            const offsetStr = offsetEntry[1].offset;
            offsetBadge = `<span class="badge" style="background:rgba(59, 130, 246, 0.15); color:#60a5fa; border:1px solid rgba(59, 130, 246, 0.3); font-family:var(--font-mono); font-size:12px; font-weight:600; padding:2px 8px; border-radius:12px; white-space:nowrap;">${this.escapeHtml(offsetStr)}</span>`;
          }

          return `
            <div class="file-card" style="padding:10px 14px; font-size:14px; font-weight:500; color:var(--color-text-main); display:flex; align-items:center; justify-content:space-between; gap:12px;">
              <div style="display:flex; align-items:center; gap:8px; overflow:hidden; text-overflow:ellipsis;">
                <span>🎬</span> <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.escapeHtml(movieName)}</span>
              </div>
              ${offsetBadge}
            </div>
          `;
        })
        .join('');
    }

    document.getElementById('fileListModal').classList.remove('hidden');
  }

  extractMovieName(filePath) {
    if (!filePath) return 'Unknown Movie';
    const parts = filePath.split('/');
    for (const part of parts) {
      const match = part.match(/^(.+?\s*\(\d{4}\))/);
      if (match) return match[1].trim();
    }
    return this.cleanFileName(filePath);
  }

  escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  }

  basename(path) {
    return path.split('/').pop();
  }

  cleanFileName(filePath) {
    let name = filePath.split('/').pop();
    name = name.replace(
      /\.(eng|spa|fre|ger|ita|por|jpn|kor|chi|rus|ara|hin|pol|dut|swe|nor|dan|fin|tur|heb|tha|vie|ind|msa|hun|ces|slk|ron|bul|ukr|ell|srp|hrv|slv|lit|lav|est|cat|eus|glg|sdh)?\.(srt|sub|ass|ssa|vtt)$/i,
      '',
    );
    name = name.replace(/\.(srt|sub|ass|ssa|vtt)$/i, '');
    const titleMatch = name.match(/^(.+?\s*\(\d{4}\))/);
    if (titleMatch) return titleMatch[1].trim();
    name = name.replace(/\s*\[.*?\]/g, '');
    name = name.replace(/\s*-[A-Za-z0-9.]+$/, '');
    return name.replace(/\s+/g, ' ').trim() || filePath.split('/').pop();
  }
}

// Global client instantiation
let client;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    client = new SubsyncarrPlusClient();
    window.client = client;
  });
} else {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  client = new SubsyncarrPlusClient();
  window.client = client;
}
