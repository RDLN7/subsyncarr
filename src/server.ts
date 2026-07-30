import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { ProcessingCoordinator } from './coordinator';
import { StateManager } from './stateManager';
import { join, resolve as resolvePath } from 'path';
import * as fs from 'fs';
import { getEnabledEngines, getScanConfig } from './config';
import cronstrue from 'cronstrue';
import parseExpression from 'cron-parser';
import { schedule, validate, ScheduledTask } from 'node-cron';
import { isTelegramConfigured } from './telegramNotifier';
import { APP_SETTING_DEFAULTS, getAppSetting, setAppSetting } from './settings';

const SETTINGS_ENV_KEYS = Object.keys(APP_SETTING_DEFAULTS) as Array<keyof typeof APP_SETTING_DEFAULTS>;
type SettingsEnvKey = keyof typeof APP_SETTING_DEFAULTS;

const SECRET_SETTINGS = new Set<SettingsEnvKey>(['AI_API_KEY', 'TELEGRAM_BOT_TOKEN']);

export class SubsyncarrPlusServer {
  private app = express();
  private httpServer = createServer(this.app);
  private wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
  private clients: Set<WebSocket> = new Set();
  private scheduledTask: ScheduledTask | null = null;

  constructor(
    private coordinator: ProcessingCoordinator,
    private stateManager: StateManager,
  ) {
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.configureSchedule(this.getCronSchedule());
  }

  private saveSettings(values: Record<string, unknown>): { error?: string } {
    for (const key of SETTINGS_ENV_KEYS) {
      const value = values[key];
      if (value === undefined) continue;
      if (typeof value !== 'string') return { error: `${key} must be a string` };
      const trimmed = value.trim();
      if (SECRET_SETTINGS.has(key) && !trimmed) continue; // Blank secret fields mean "keep existing".
      if (key === 'AI_BASE_URL' && trimmed) {
        try {
          const url = new URL(trimmed);
          if (!['http:', 'https:'].includes(url.protocol)) return { error: 'AI_BASE_URL must use http or https' };
        } catch {
          return { error: 'AI_BASE_URL must be a valid URL' };
        }
      }
      setAppSetting(key, trimmed);
      this.stateManager.setSetting(key, trimmed);
    }

    const engines = getEnabledEngines();
    if (!engines.length) return { error: 'Select at least one processing engine' };
    return {};
  }

  private getSettingsResponse() {
    const config = getScanConfig();
    return {
      scanPaths: config.includePaths.join(', '),
      excludePaths: config.excludePaths.join(', '),
      engines: getEnabledEngines(),
      maxConcurrentTasks: getAppSetting('MAX_CONCURRENT_SYNC_TASKS'),
      overwriteOriginal: getAppSetting('OVERWRITE_ORIGINAL') === 'true',
      ai: {
        baseUrl: getAppSetting('AI_BASE_URL'),
        model: getAppSetting('AI_MODEL'),
        targetLanguage: getAppSetting('AI_TARGET_LANGUAGE'),
        outputLanguage: getAppSetting('AI_OUTPUT_LANGUAGE'),
        requiredSubtitleLanguages: getAppSetting('AI_REQUIRED_SUBTITLE_LANGUAGES'),
        batchCues: getAppSetting('AI_BATCH_CUES'),
        batchChars: getAppSetting('AI_BATCH_CHARS'),
        maxOutputTokens: getAppSetting('AI_MAX_OUTPUT_TOKENS'),
        timeoutMs: getAppSetting('AI_TIMEOUT_MS'),
        apiKeyConfigured: Boolean(getAppSetting('AI_API_KEY')),
      },
      telegram: {
        chatId: getAppSetting('TELEGRAM_CHAT_ID'),
        tokenConfigured: Boolean(getAppSetting('TELEGRAM_BOT_TOKEN')),
      },
    };
  }

  private getCronSchedule(): string {
    return this.stateManager.getSetting('cron_schedule') || getAppSetting('CRON_SCHEDULE');
  }

  private configureSchedule(cronSchedule: string): void {
    this.scheduledTask?.stop();
    this.scheduledTask?.destroy();
    this.scheduledTask = null;
    if (cronSchedule === 'disabled') return;

    this.scheduledTask = schedule(cronSchedule, async () => {
      console.log(`[${new Date().toISOString()}] Starting scheduled run (${cronSchedule})`);
      try {
        await this.coordinator.startRun();
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Scheduled run failed:`, error);
      }
    });
    console.log(`[${new Date().toISOString()}] Scheduled runs: ${cronSchedule}`);
  }

  private isParsableCron(cronSchedule: string): boolean {
    try {
      parseExpression.parse(cronSchedule);
      return true;
    } catch {
      return false;
    }
  }

  private setupMiddleware() {
    this.app.disable('x-powered-by');
    this.app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; base-uri 'self'; frame-ancestors 'self'",
      );
      next();
    });
    this.app.use(express.json({ limit: '32kb' }));
    this.app.use(express.static(join(__dirname, '../public'), { maxAge: 0, etag: true }));
  }

  private isAllowedScanPath(candidate: string): boolean {
    try {
      const resolvedCandidate = fs.realpathSync(resolvePath(candidate));
      if (!fs.statSync(resolvedCandidate).isDirectory()) return false;
      const includePaths = getScanConfig().includePaths;
      if (includePaths.length === 0) {
        return true;
      }
      const allowedRoots = [...includePaths, '/movies', '/tv', '/media', '/app/data'];
      return allowedRoots.some((root) => {
        try {
          const resolvedRoot = fs.realpathSync(resolvePath(root));
          return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}/`);
        } catch {
          return candidate === root || candidate.startsWith(`${root}/`);
        }
      });
    } catch {
      return false;
    }
  }

  private setupRoutes() {
    this.app.get('/health', (_req, res) => {
      res.status(200).json({ status: 'ok' });
    });

    // Get configuration status
    this.app.get('/api/config', (req, res) => {
      const config = getScanConfig();
      const isDefaultPath = config.includePaths.length === 1 && config.includePaths[0] === '/scan_dir';

      // Get cron schedule info
      const cronSchedule = this.getCronSchedule();
      let scheduleDescription = '';
      let nextRun = null;

      if (cronSchedule !== 'disabled') {
        try {
          scheduleDescription = cronstrue.toString(cronSchedule);
          const interval = parseExpression.parse(cronSchedule);
          nextRun = interval.next().toDate().getTime();
        } catch (error) {
          console.error('Error parsing cron schedule:', error);
          scheduleDescription = cronSchedule;
        }
      }

      res.json({
        paths: config.includePaths,
        excludePaths: config.excludePaths,
        isConfigured: !isDefaultPath,
        schedule: {
          enabled: cronSchedule !== 'disabled',
          cron: cronSchedule,
          description: scheduleDescription,
          nextRun: nextRun,
        },
        aiTranslation: {
          enabled: getEnabledEngines().includes('ai-translate'),
          configured: Boolean(getAppSetting('AI_BASE_URL') && getAppSetting('AI_API_KEY') && getAppSetting('AI_MODEL')),
          baseUrl: getAppSetting('AI_BASE_URL'),
          model: getAppSetting('AI_MODEL'),
          targetLanguage: getAppSetting('AI_TARGET_LANGUAGE'),
          outputLanguage: getAppSetting('AI_OUTPUT_LANGUAGE'),
          requiredSubtitleLanguages: getAppSetting('AI_REQUIRED_SUBTITLE_LANGUAGES'),
          batchCues: getAppSetting('AI_BATCH_CUES'),
          batchChars: getAppSetting('AI_BATCH_CHARS'),
          timeoutMs: getAppSetting('AI_TIMEOUT_MS'),
        },
        telegram: { configured: isTelegramConfigured() },
        settings: this.getSettingsResponse(),
      });
    });

    this.app.put('/api/settings', (req, res) => {
      const result = this.saveSettings(req.body || {});
      if (result.error) return res.status(400).json(result);
      this.broadcast({ type: 'config:updated' });
      res.json({ success: true, settings: this.getSettingsResponse() });
    });

    this.app.put('/api/settings/schedule', (req, res) => {
      const cronSchedule = typeof req.body?.cron === 'string' ? req.body.cron.trim() : '';
      if (!cronSchedule) return res.status(400).json({ error: 'Schedule is required' });
      if (cronSchedule !== 'disabled' && (!validate(cronSchedule) || !this.isParsableCron(cronSchedule))) {
        return res.status(400).json({ error: 'Invalid cron schedule' });
      }
      this.stateManager.setSetting('cron_schedule', cronSchedule);
      setAppSetting('CRON_SCHEDULE', cronSchedule);
      this.stateManager.setSetting('CRON_SCHEDULE', cronSchedule);
      this.configureSchedule(cronSchedule);
      this.broadcast({ type: 'config:updated' });
      res.json({ success: true, cron: cronSchedule });
    });

    // Browse directories within the configured SCAN_PATHS.
    // No `path` query → returns the configured roots as virtual top-level entries.
    // Otherwise enumerates immediate subdirectories of `path`, but only if `path`
    // resolves inside one of the configured roots.
    this.app.get('/api/browse', (req, res) => {
      const requestedPath = typeof req.query.path === 'string' && req.query.path.trim() ? req.query.path.trim() : '/';
      console.log(`[${new Date().toISOString()}] GET /api/browse path=${requestedPath}`);

      const normalizedRequest = resolvePath(requestedPath);

      let resolvedPath: string;
      try {
        resolvedPath = fs.realpathSync(normalizedRequest);
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code === 'ENOENT') return res.status(404).json({ error: 'path does not exist' });
        if (code === 'EACCES') return res.status(403).json({ error: 'permission denied' });
        return res.status(500).json({ error: (err as Error).message });
      }

      try {
        const entries = fs
          .readdirSync(resolvedPath, { withFileTypes: true })
          .filter((d) => !d.name.startsWith('.') && d.isDirectory())
          .map((d) => ({ name: d.name, path: join(normalizedRequest, d.name), isDir: true, isRoot: false }))
          .sort((a, b) => a.name.localeCompare(b.name));

        return res.json({ path: normalizedRequest, entries });
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code === 'EACCES') return res.status(403).json({ error: 'permission denied' });
        return res.status(500).json({ error: (err as Error).message });
      }
    });

    // Get current status
    this.app.get('/api/status', (req, res) => {
      console.log(`[${new Date().toISOString()}] GET /api/status`);
      const currentRun = this.stateManager.getCurrentRun();
      res.json({
        currentRun,
        files: currentRun ? this.stateManager.getFileResults(currentRun.id) : [],
        isRunning: this.coordinator.isRunning(),
      });
    });

    // Get run history
    this.app.get('/api/history', (req, res) => {
      const requestedLimit = Number.parseInt(req.query.limit as string, 10);
      const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
      console.log(`[${new Date().toISOString()}] GET /api/history (limit: ${limit})`);
      res.json(this.stateManager.getRunHistory(limit));
    });

    // Get specific run details
    this.app.get('/api/runs/:id', (req, res) => {
      console.log(`[${new Date().toISOString()}] GET /api/runs/${req.params.id}`);
      const currentRun = this.stateManager.getCurrentRun();
      const requestedId = req.params.id;

      // Check current run first
      if (currentRun && currentRun.id === requestedId) {
        return res.json({
          run: currentRun,
          files: this.stateManager.getFileResults(currentRun.id),
        });
      }

      // Check history
      const history = this.stateManager.getRunHistory(1000);
      const run = history.find((r) => r.id === requestedId);

      if (!run) {
        return res.status(404).json({ error: 'Run not found' });
      }

      res.json({
        run,
        files: this.stateManager.getFileResults(run.id),
      });
    });

    // Get logs for a specific run
    this.app.get('/api/runs/:id/logs', (req, res) => {
      console.log(`[${new Date().toISOString()}] GET /api/runs/${req.params.id}/logs`);
      const requestedId = req.params.id;

      const currentRun = this.stateManager.getCurrentRun();
      const history = this.stateManager.getRunHistory(1000);
      const run = currentRun?.id === requestedId ? currentRun : history.find((r) => r.id === requestedId);

      let logs = this.stateManager.getRunLogs(requestedId);
      if ((!logs || !logs.trim()) && currentRun?.id === requestedId) {
        logs = this.coordinator.getLogs().join('\n');
      }

      res.json({ logs: logs || (run ? 'No log entries recorded for this run.' : 'Run not found.') });
    });

    this.app.post('/api/run/start', async (req, res) => {
      const paths = req.body?.paths;
      console.log(
        `[${new Date().toISOString()}] POST /api/run/start${paths ? ` (custom paths: ${paths.join(', ')})` : ' (default paths)'}`,
      );

      try {
        if (this.coordinator.isRunning()) {
          console.log(`[${new Date().toISOString()}] Request rejected: Run already in progress`);
          return res.status(409).json({ error: 'A run is already in progress' });
        }

        if (
          paths !== undefined &&
          (!Array.isArray(paths) ||
            !paths.every((path): path is string => typeof path === 'string' && this.isAllowedScanPath(path)))
        ) {
          const configured = getScanConfig().includePaths;
          const msg = configured.length
            ? `Custom path must be inside configured scan folders (${configured.join(', ')}). Add it in Preferences -> Library & Paths.`
            : 'Custom path must be a valid directory.';
          return res.status(400).json({ error: msg });
        }
        const config = paths ? { includePaths: paths, excludePaths: [] } : undefined;

        const runId = await this.coordinator.startRun(config);
        res.json({ runId });
      } catch (error) {
        console.log(
          `[${new Date().toISOString()}] Error starting run: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Stop current run
    this.app.post('/api/run/stop', (_req, res) => {
      console.log(`[${new Date().toISOString()}] POST /api/run/stop`);
      try {
        this.coordinator.stopRun();
        res.json({ success: true });
      } catch (error) {
        console.log(
          `[${new Date().toISOString()}] Error stopping run: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Skip a file
    this.app.post('/api/file/skip', (req, res) => {
      const { filePath } = req.body;

      if (!filePath) {
        console.log(`[${new Date().toISOString()}] POST /api/file/skip - Missing filePath`);
        return res.status(400).json({ error: 'filePath required' });
      }

      console.log(`[${new Date().toISOString()}] POST /api/file/skip - ${filePath.split('/').pop()}`);
      this.coordinator.skipFile(filePath);
      res.json({ success: true });
    });

    // Clear completed files
    this.app.post('/api/files/clear', (req, res) => {
      console.log(`[${new Date().toISOString()}] POST /api/files/clear`);
      this.stateManager.clearCompletedFiles();

      // Broadcast updated state to all clients
      const currentRun = this.stateManager.getCurrentRun();
      this.broadcast({
        type: 'files:cleared',
        data: {
          currentRun,
          files: currentRun
            ? this.stateManager.getFileResults(currentRun.id).filter((f) => f.status === 'processing')
            : [],
        },
      });

      res.json({ success: true });
    });

    // Get skip status statistics
    this.app.get('/api/skip-status', (_req, res) => {
      console.log(`[${new Date().toISOString()}] GET /api/skip-status`);
      const stats = this.stateManager.getFailureStats();
      res.json(stats);
    });

    // Get skip status for specific file
    this.app.get('/api/skip-status/*filePath', (req, res) => {
      const rawFilePath = (req.params as { filePath?: string | string[] }).filePath;
      const filePath = decodeURIComponent(Array.isArray(rawFilePath) ? rawFilePath.join('/') : rawFilePath || '');

      if (!filePath) {
        return res.status(400).json({ error: 'filePath required' });
      }

      console.log(`[${new Date().toISOString()}] GET /api/skip-status/${filePath.split('/').pop()}`);

      const skippedEngines = this.stateManager.getSkippedEngines(filePath);
      res.json({ filePath, skippedEngines });
    });

    // Reset skip status for a file
    this.app.post('/api/skip-status/reset', (req, res) => {
      const { filePath, engine } = req.body;

      if (!filePath) {
        return res.status(400).json({ error: 'filePath required' });
      }

      console.log(
        `[${new Date().toISOString()}] POST /api/skip-status/reset - ${filePath.split('/').pop()}${engine ? ` (${engine})` : ' (all engines)'}`,
      );

      this.stateManager.resetSkipStatus(filePath, engine);
      res.json({ success: true });
    });
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws) => {
      console.log(`[${new Date().toISOString()}] WebSocket client connected (total: ${this.clients.size + 1})`);
      this.clients.add(ws);

      // Send initial state
      const currentRun = this.stateManager.getCurrentRun();
      ws.send(
        JSON.stringify({
          type: 'state',
          data: {
            currentRun,
            files: currentRun ? this.stateManager.getFileResults(currentRun.id) : [],
            isRunning: this.coordinator.isRunning(),
          },
        }),
      );

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[${new Date().toISOString()}] WebSocket client disconnected (total: ${this.clients.size})`);
      });
    });

    // Broadcast state changes to all clients
    this.stateManager.on('run:started', (run) => {
      console.log(`[${new Date().toISOString()}] Broadcasting run:started to ${this.clients.size} clients`);
      this.broadcast({ type: 'run:started', data: run });
    });

    this.stateManager.on('run:completed', (run) => {
      console.log(`[${new Date().toISOString()}] Broadcasting run:completed to ${this.clients.size} clients`);
      this.broadcast({ type: 'run:completed', data: run });
    });

    this.stateManager.on('run:cancelled', (run) => {
      console.log(`[${new Date().toISOString()}] Broadcasting run:cancelled to ${this.clients.size} clients`);
      this.broadcast({ type: 'run:cancelled', data: run });
    });

    this.stateManager.on('file:updated', ({ file, run }) => {
      this.broadcast({ type: 'file:updated', data: { file, run } });
    });
  }

  private broadcast(message: unknown) {
    const data = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  start(port: number = 3000, host: string = '0.0.0.0') {
    this.httpServer.listen(port, host, () => {
      console.log(`[${new Date().toISOString()}] Subsyncarr Plus UI available at http://${host}:${port}`);
    });
  }

  close() {
    this.scheduledTask?.stop();
    this.scheduledTask?.destroy();
    this.clients.forEach((client) => client.terminate());
    this.clients.clear();
    this.httpServer.close();
    this.wss.close();
  }
}
