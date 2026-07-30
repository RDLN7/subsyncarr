import { exec } from 'child_process';
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { getAppSetting } from './settings';

export interface ProcessingResult {
  success: boolean;
  message: string;
  stdout?: string;
  stderr?: string;
  skipped?: boolean;
  offset?: string;
  offsetSeconds?: number;
}

function parseSrtTimestampToSeconds(timestampStr: string): number | null {
  const match = timestampStr.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const millis = parseInt(match[4], 10);
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function extractFirstCueStartTimes(srtContent: string, maxCues: number = 10): number[] {
  const times: number[] = [];
  const lines = srtContent.split(/\r?\n/);
  for (const line of lines) {
    if (line.includes('-->')) {
      const parts = line.split('-->');
      if (parts[0]) {
        const sec = parseSrtTimestampToSeconds(parts[0].trim());
        if (sec !== null) {
          times.push(sec);
          if (times.length >= maxCues) break;
        }
      }
    }
  }
  return times;
}

export function calculateSrtOffsetFromContents(
  originalContent: string | null,
  syncedContent: string | null,
): { offsetSeconds: number; offset: string } | null {
  if (!originalContent || !syncedContent) return null;
  try {
    const origTimes = extractFirstCueStartTimes(originalContent, 10);
    const syncTimes = extractFirstCueStartTimes(syncedContent, 10);

    if (origTimes.length === 0 || syncTimes.length === 0) return null;

    const diffs: number[] = [];
    const count = Math.min(origTimes.length, syncTimes.length);
    for (let i = 0; i < count; i++) {
      diffs.push(syncTimes[i] - origTimes[i]);
    }

    diffs.sort((a, b) => a - b);
    const medianDiff = diffs[Math.floor(diffs.length / 2)];

    const rounded = Math.round(medianDiff * 10) / 10;
    const formatted = `${rounded >= 0 ? '+' : ''}${rounded.toFixed(1)}s`;

    return {
      offsetSeconds: rounded,
      offset: formatted,
    };
  } catch {
    return null;
  }
}

export function getTimeoutMs(): number {
  // Support both SYNC_TIMEOUT (seconds) and SYNC_ENGINE_TIMEOUT_MS (milliseconds)
  const seconds = getAppSetting('SYNC_TIMEOUT');
  if (seconds) {
    const val = parseInt(seconds, 10);
    if (!isNaN(val) && val > 0) return val * 1000;
  }
  const ms = getAppSetting('SYNC_ENGINE_TIMEOUT_MS');
  if (ms) {
    const val = parseInt(ms, 10);
    if (!isNaN(val) && val > 0) return val;
  }
  return 1800000; // 30 minutes default
}

export function execPromise(command: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string }> {
  const timeout = timeoutMs ?? getTimeoutMs();
  return new Promise((resolve, reject) => {
    exec(command, { timeout, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          reject(new Error(`Timed out after ${timeout / 1000}s: ${command}`));
        } else {
          reject(error);
        }
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export function isValidSrtFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).size > 100;
  } catch {
    return false;
  }
}

export function findReferenceSubtitle(srtPath: string, videoPath?: string): string | null {
  const directory = dirname(srtPath);

  if (videoPath) {
    const videoBaseName = basename(videoPath, extname(videoPath));
    const candidates = [
      join(directory, `${videoBaseName}.en.srt`),
      join(directory, `${videoBaseName}.eng.srt`),
      join(directory, `${videoBaseName}.English.srt`),
      join(directory, `${videoBaseName}.srt`),
    ];

    for (const candidate of candidates) {
      if (candidate !== srtPath && isValidSrtFile(candidate)) {
        return candidate;
      }
    }
  }

  try {
    const files = readdirSync(directory);
    for (const file of files) {
      if (!file.endsWith('.srt')) continue;
      if (
        file.includes('.alass.') ||
        file.includes('.ffsubsync.') ||
        file.includes('.autosubsync.') ||
        file.includes('.AI-CHT.') ||
        file.includes('.extracted_ref.')
      ) {
        continue;
      }
      const fullPath = join(directory, file);
      if (fullPath !== srtPath && isValidSrtFile(fullPath)) {
        return fullPath;
      }
    }
  } catch {
    // Ignore directory read errors
  }

  return null;
}

export async function findOrExtractReferenceSubtitle(
  srtPath: string,
  videoPath?: string,
): Promise<{ refPath: string; isSubRef: boolean; isExtracted: boolean }> {
  const extRef = findReferenceSubtitle(srtPath, videoPath);
  if (extRef) {
    return { refPath: extRef, isSubRef: true, isExtracted: false };
  }

  if (videoPath && existsSync(videoPath)) {
    const directory = dirname(srtPath);
    const videoBaseName = basename(videoPath, extname(videoPath));
    const extractedPath = join(directory, `${videoBaseName}.extracted_ref.srt`);

    if (isValidSrtFile(extractedPath)) {
      return { refPath: extractedPath, isSubRef: true, isExtracted: true };
    }

    // Remove stale/empty extracted file if it exists
    if (existsSync(extractedPath)) {
      try {
        unlinkSync(extractedPath);
      } catch {
        /* ignore */
      }
    }

    const langs = ['eng', 'en', 'english', 'zh', 'chi', 'zho', 'cht', 'chs'];
    for (const lang of langs) {
      try {
        const extractCmd = `ffmpeg -y -i "${videoPath}" -map 0:s:m:language:${lang} -c:s srt "${extractedPath}"`;
        await execPromise(extractCmd, 30000);

        if (isValidSrtFile(extractedPath)) {
          return { refPath: extractedPath, isSubRef: true, isExtracted: true };
        }
      } catch {
        // Try next language tag
      }
    }

    try {
      const fallbackCmd = `ffmpeg -y -i "${videoPath}" -map 0:s:0 -c:s srt "${extractedPath}"`;
      await execPromise(fallbackCmd, 30000);
      if (isValidSrtFile(extractedPath)) {
        return { refPath: extractedPath, isSubRef: true, isExtracted: true };
      }
    } catch {
      // Fallback to video audio alignment
    }

    // Clean up empty/failed extracted file if left behind
    if (existsSync(extractedPath) && !isValidSrtFile(extractedPath)) {
      try {
        unlinkSync(extractedPath);
      } catch {
        /* ignore */
      }
    }
  }

  return { refPath: videoPath || srtPath, isSubRef: false, isExtracted: false };
}
