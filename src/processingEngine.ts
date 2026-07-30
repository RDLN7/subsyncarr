import EventEmitter from 'events';
import { ScanConfig, getEnabledEngines, getMaxConcurrentTasks, getScanConfig } from './config';
import { findAllSrtFiles } from './findAllSrtFiles';
import { findMatchingVideoFile } from './findMatchingVideoFile';
import { generateFfsubsyncSubtitles } from './generateFfsubsyncSubtitles';
import { generateAutosubsyncSubtitles } from './generateAutosubsyncSubtitles';
import { generateAlassSubtitles } from './generateAlassSubtitles';
import { generateAiTranslatedSubtitles, getAiTranslationOutputPath } from './generateAiTranslatedSubtitles';
import { notifyTelegram } from './telegramNotifier';
import { StateManager } from './stateManager';

export class ProcessingEngine extends EventEmitter {
  private cancelledFiles: Set<string> = new Set();
  private maxConcurrent: number;
  private enabledEngines: string[];
  private logBuffer: string[] = [];
  private maxLogBufferSize: number;
  public stateManager?: StateManager;

  private getAiSyncEngines(): string[] {
    return this.enabledEngines.filter((engine) => ['ffsubsync', 'autosubsync', 'alass'].includes(engine));
  }

  private recordSkippedAiSynchronization(srtPath: string, reason: string): void {
    for (const engine of this.getAiSyncEngines()) {
      this.emit('file:engine_completed', {
        srtPath,
        engine: `${engine} (AI)`,
        result: { success: true, duration: 0, message: reason, skipped: true },
      });
    }
  }

  constructor() {
    super();
    this.maxConcurrent = getMaxConcurrentTasks();
    this.enabledEngines = getEnabledEngines();
    this.maxLogBufferSize = Math.max(100, Number.parseInt(process.env.LOG_BUFFER_SIZE || '1000', 10) || 1000);
  }

  private log(message: string): void {
    console.log(message);

    // Ring buffer - remove oldest if at capacity
    if (this.logBuffer.length >= this.maxLogBufferSize) {
      this.logBuffer.shift(); // Remove oldest
    }

    this.logBuffer.push(message);
    this.emit('log', message);
  }

  getLogs(): string[] {
    return [...this.logBuffer];
  }

  clearLogs(): void {
    this.logBuffer = [];
  }

  reloadConfiguration(): void {
    this.maxConcurrent = getMaxConcurrentTasks();
    this.enabledEngines = getEnabledEngines();
  }

  async processRun(config?: ScanConfig): Promise<void> {
    const scanConfig = config || getScanConfig();
    this.log(`[${new Date().toISOString()}] Scanning for subtitle files...`);
    this.log(`[${new Date().toISOString()}] Scan paths: ${JSON.stringify(scanConfig.includePaths)}`);

    const { files: srtFiles, skippedCount } = await findAllSrtFiles(scanConfig);
    this.log(
      `[${new Date().toISOString()}] Found ${srtFiles.length} subtitle files to process (${skippedCount} already synced)`,
    );

    this.emit('run:files_found', srtFiles, skippedCount);

    // Process in batches
    this.log(`[${new Date().toISOString()}] Processing with concurrency: ${this.maxConcurrent}`);
    this.log(`[${new Date().toISOString()}] Enabled engines: ${this.enabledEngines.join(', ')}`);

    for (let i = 0; i < srtFiles.length; i += this.maxConcurrent) {
      const batch = srtFiles.slice(i, i + this.maxConcurrent);
      this.log(
        `[${new Date().toISOString()}] Processing batch ${Math.floor(i / this.maxConcurrent) + 1}/${Math.ceil(srtFiles.length / this.maxConcurrent)} (${batch.length} files)`,
      );
      await Promise.all(batch.map((file) => this.processFile(file)));
    }

    this.log(`[${new Date().toISOString()}] All files processed`);
  }

  private async synchronizeAiSubtitle(
    sourceSrtPath: string,
    videoPath: string | null,
    fileName: string,
  ): Promise<void> {
    const translatedPath = getAiTranslationOutputPath(sourceSrtPath);
    const syncEngines = this.getAiSyncEngines();

    if (!videoPath) {
      this.recordSkippedAiSynchronization(sourceSrtPath, 'No matching video found for AI subtitle timing sync');
      return;
    }

    for (const engine of syncEngines) {
      if (this.cancelledFiles.has(sourceSrtPath)) return;

      const recordEngine = `${engine} (AI)`;
      if (this.stateManager?.shouldSkipEngine(sourceSrtPath, recordEngine)) {
        this.emit('file:engine_completed', {
          srtPath: sourceSrtPath,
          engine: recordEngine,
          result: { success: false, duration: 0, message: 'Skipped due to 3+ consecutive failures', skipped: true },
        });
        continue;
      }
      this.log(`[${new Date().toISOString()}] Starting ${recordEngine} for: ${fileName}`);
      this.emit('file:engine_started', { srtPath: sourceSrtPath, engine: recordEngine });
      const startTime = Date.now();

      try {
        let result;
        switch (engine) {
          case 'ffsubsync':
            result = await generateFfsubsyncSubtitles(translatedPath, videoPath, false);
            break;
          case 'autosubsync':
            result = await generateAutosubsyncSubtitles(translatedPath, videoPath, false);
            break;
          case 'alass':
            result = await generateAlassSubtitles(translatedPath, videoPath, false);
            break;
          default:
            continue;
        }

        const duration = Date.now() - startTime;
        const status = result.success ? '✓' : '✗';
        const shiftText = result.offset ? `, shift: ${result.offset}` : '';
        this.log(
          `[${new Date().toISOString()}] ${status} ${recordEngine} completed (${(duration / 1000).toFixed(1)}s${shiftText}): ${fileName}`,
        );
        this.emit('file:engine_completed', {
          srtPath: sourceSrtPath,
          engine: recordEngine,
          result: { ...result, duration },
        });
        if (result.success && !result.skipped) {
          const shiftNote = result.offset ? `\nAdjustment: ${result.offset}` : '';
          await notifyTelegram(
            `✅ Subtitle time synced\n${fileName}\nEngine: ${recordEngine}${shiftNote}\nOutput: ${translatedPath}`,
          );
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);
        this.log(
          `[${new Date().toISOString()}] ✗ ${recordEngine} failed (${(duration / 1000).toFixed(1)}s): ${fileName}`,
        );
        this.log(`[${new Date().toISOString()}]   Error: ${message}`);
        this.emit('file:engine_completed', {
          srtPath: sourceSrtPath,
          engine: recordEngine,
          result: { success: false, message, duration },
        });
      }
    }
  }

  private async processFile(srtPath: string): Promise<void> {
    const fileName = srtPath.split('/').pop();
    this.log(`[${new Date().toISOString()}] Processing: ${fileName}`);

    // Check if cancelled
    if (this.cancelledFiles.has(srtPath)) {
      this.log(`[${new Date().toISOString()}] Skipped (cancelled): ${fileName}`);
      this.emit('file:skipped', { srtPath, reason: 'cancelled' });
      return;
    }

    const videoPath = findMatchingVideoFile(srtPath);

    this.emit('file:started', { srtPath, videoPath });

    if (!videoPath) {
      this.log(`[${new Date().toISOString()}] No matching video found for: ${fileName}`);
    } else {
      this.log(`[${new Date().toISOString()}] Found video: ${videoPath.split('/').pop()}`);
    }

    // Process with each enabled engine
    let anyEngineSucceeded = false;
    let allEnginesSkipped = true;
    // AI must run first so its generated subtitle can immediately be synchronized below.
    const engines = [...this.enabledEngines].sort((left, right) => {
      if (left === 'ai-translate') return -1;
      if (right === 'ai-translate') return 1;
      return 0;
    });
    for (const engine of engines) {
      // Check cancellation before each engine
      if (this.cancelledFiles.has(srtPath)) {
        this.log(`[${new Date().toISOString()}] Skipped (cancelled): ${fileName}`);
        this.emit('file:skipped', { srtPath, reason: 'cancelled' });
        return;
      }

      // Timing engines require a video file; AI translation can operate on standalone subtitles.
      if (!videoPath && engine !== 'ai-translate') {
        this.log(`[${new Date().toISOString()}] ⊘ ${engine} skipped (no matching video file): ${fileName}`);
        this.emit('file:engine_completed', {
          srtPath,
          engine,
          result: {
            success: false,
            duration: 0,
            message: 'No matching video found for timing synchronization',
            skipped: true,
          },
        });
        continue;
      }

      // Check if engine should be skipped due to consecutive failures
      if (this.stateManager?.shouldSkipEngine(srtPath, engine)) {
        this.log(`[${new Date().toISOString()}] ⊘ Skipping ${engine} (3+ consecutive failures): ${fileName}`);
        this.emit('file:engine_completed', {
          srtPath,
          engine,
          result: {
            success: false,
            duration: 0,
            message: 'Skipped due to 3+ consecutive failures',
            skipped: true,
          },
        });
        if (engine === 'ai-translate')
          this.recordSkippedAiSynchronization(srtPath, 'Skipped because AI translation is unavailable');
        continue; // Skip to next engine (allEnginesSkipped remains true)
      }

      // Skip unchanged subtitle for this engine if it was already processed with identical content
      if (this.stateManager && (await this.stateManager.shouldSkipUnchangedSubtitle(srtPath, engine))) {
        this.log(`[${new Date().toISOString()}] ⊘ ${engine} skipped (subtitle unchanged): ${fileName}`);
        this.emit('file:engine_completed', {
          srtPath,
          engine,
          result: {
            success: true,
            duration: 0,
            message: 'Skipped because subtitle content is unchanged since last successful run',
            skipped: true,
          },
        });
        if (engine === 'ai-translate')
          this.recordSkippedAiSynchronization(srtPath, 'Skipped because the source subtitle is unchanged');
        continue;
      }

      this.log(`[${new Date().toISOString()}] Starting ${engine} for: ${fileName}`);
      this.emit('file:engine_started', { srtPath, engine });

      const startTime = Date.now();
      let result;

      try {
        switch (engine) {
          case 'ffsubsync':
            result = await generateFfsubsyncSubtitles(srtPath, videoPath!);
            break;
          case 'autosubsync':
            result = await generateAutosubsyncSubtitles(srtPath, videoPath!);
            break;
          case 'alass':
            result = await generateAlassSubtitles(srtPath, videoPath!);
            break;
          case 'ai-translate':
            result = await generateAiTranslatedSubtitles(srtPath);
            break;
          default:
            continue;
        }

        const duration = Date.now() - startTime;

        // If this engine was skipped (already processed), log and continue
        if (result.skipped) {
          this.log(`[${new Date().toISOString()}] ⊘ ${engine} skipped (already processed): ${fileName}`);
          this.emit('file:engine_completed', {
            srtPath,
            engine,
            result: { ...result, duration },
          });
          if (engine === 'ai-translate') this.recordSkippedAiSynchronization(srtPath, result.message);
          continue; // allEnginesSkipped stays true
        }

        // An engine actually ran (not skipped), so not all are skipped
        allEnginesSkipped = false;

        const status = result.success ? '✓' : '✗';
        const shiftText = result.offset ? `, shift: ${result.offset}` : '';
        this.log(
          `[${new Date().toISOString()}] ${status} ${engine} completed (${(duration / 1000).toFixed(1)}s${shiftText}): ${fileName}`,
        );
        if (!result.success) {
          this.log(`[${new Date().toISOString()}]   Error: ${result.message}`);
          // Log stderr if available for debugging
          if (result.stderr) {
            this.log(`[${new Date().toISOString()}]   Stderr: ${result.stderr.substring(0, 500)}`);
          }
        }

        if (result.success) {
          anyEngineSucceeded = true;
          if (this.stateManager) {
            const postProcessHash = await this.stateManager.getSubtitleContentHash(srtPath);
            this.stateManager.recordProcessedSubtitleHash(srtPath, engine, postProcessHash);
          }
          if (engine === 'ai-translate') {
            await notifyTelegram(
              `✅ AI subtitle generated\n${fileName}\nOutput: ${getAiTranslationOutputPath(srtPath)}`,
            );
          } else {
            const shiftNote = result.offset ? `\nAdjustment: ${result.offset}` : '';
            await notifyTelegram(`✅ Subtitle time synced\n${fileName}\nEngine: ${engine}${shiftNote}`);
          }
        }

        this.emit('file:engine_completed', {
          srtPath,
          engine,
          result: { ...result, duration },
        });

        if (engine === 'ai-translate' && result.success && !result.skipped) {
          await this.synchronizeAiSubtitle(srtPath, videoPath, fileName || srtPath);
        }
      } catch (error) {
        // Engine attempted to run (not skipped), so not all are skipped
        allEnginesSkipped = false;

        const duration = Date.now() - startTime;
        this.log(`[${new Date().toISOString()}] ✗ ${engine} failed (${(duration / 1000).toFixed(1)}s): ${fileName}`);
        this.log(`[${new Date().toISOString()}]   Error: ${error instanceof Error ? error.message : String(error)}`);

        this.emit('file:engine_completed', {
          srtPath,
          engine,
          result: {
            success: false,
            message: error instanceof Error ? error.message : String(error),
            duration,
          },
        });
      }
    }

    if (anyEngineSucceeded) {
      this.log(`[${new Date().toISOString()}] ✓ Completed successfully for: ${fileName}`);
      this.emit('file:completed', { srtPath });
    } else if (allEnginesSkipped) {
      this.log(`[${new Date().toISOString()}] ⊘ All engines skipped for: ${fileName}`);
      this.emit('file:skipped', { srtPath, reason: 'all_engines_skipped' });
    } else {
      this.log(`[${new Date().toISOString()}] ✗ All engines failed for: ${fileName}`);
      this.emit('file:failed', { srtPath });
    }
  }

  skipFile(filePath: string): void {
    this.cancelledFiles.add(filePath);
    this.emit('file:skip_requested', { filePath });
  }

  stopAllProcessing(allFiles: string[]): void {
    this.log(`[${new Date().toISOString()}] Stop requested - cancelling all remaining files`);
    allFiles.forEach((file) => this.cancelledFiles.add(file));
  }

  reset(): void {
    this.cancelledFiles.clear();
    this.clearLogs();
  }
}
