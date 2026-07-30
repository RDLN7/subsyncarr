import { readdir } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { existsSync } from 'fs';
import { getEnabledEngines, parseCommaSeparated, ScanConfig } from './config';
import { getAiSynchronizedOutputPath, getAiTranslationOutputPath } from './generateAiTranslatedSubtitles';
import { getAppSetting } from './settings';

function isAlreadySynced(srtPath: string, engines: string[]): boolean {
  const directory = dirname(srtPath);
  const srtBaseName = basename(srtPath, '.srt');

  return engines.every((engine) => {
    if (engine === 'ai-translate') return existsSync(getAiTranslationOutputPath(srtPath));
    const sourceOutput = join(directory, `${srtBaseName}.${engine}.srt`);
    const aiOutput = engines.includes('ai-translate') ? getAiSynchronizedOutputPath(srtPath, engine) : undefined;
    return existsSync(sourceOutput) && (!aiOutput || existsSync(aiOutput));
  });
}

function matchesLanguageFilter(fileName: string, languages: string[]): boolean {
  if (languages.length === 0) return true;

  // Extract language tag from filename like "movie.en.srt" or "movie.eng.srt"
  const parts = basename(fileName, '.srt').split('.');
  if (parts.length < 2) return false;

  const langTag = parts[parts.length - 1].toLowerCase();
  return languages.some((lang) => lang.toLowerCase() === langTag);
}

export interface ScanResult {
  files: string[];
  skippedCount: number;
}

export async function findAllSrtFiles(config: ScanConfig): Promise<ScanResult> {
  const engines = getEnabledEngines();
  const languages = parseCommaSeparated(getAppSetting('SYNC_LANGUAGES'));
  const files: string[] = [];
  let skippedCount = 0;

  if (languages.length > 0) {
    console.log(`${new Date().toLocaleString()} Language filter active: ${languages.join(', ')}`);
  }

  async function scan(directory: string): Promise<void> {
    if (
      config.excludePaths.some((excludePath) => directory === excludePath || directory.startsWith(`${excludePath}/`))
    ) {
      return;
    }

    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (
        entry.isFile() &&
        extname(entry.name).toLowerCase() === '.srt' &&
        !entry.name.includes('.ffsubsync.') &&
        !entry.name.includes('.alass.') &&
        !entry.name.includes('.autosubsync.') &&
        !entry.name.includes('.AI.') &&
        !entry.name.includes('.extracted_ref.') &&
        matchesLanguageFilter(entry.name, languages)
      ) {
        if (isAlreadySynced(fullPath, engines)) {
          skippedCount++;
        } else {
          files.push(fullPath);
        }
      }
    }
  }

  // Scan all included paths
  for (const includePath of config.includePaths) {
    if (existsSync(includePath)) {
      await scan(includePath);
    } else {
      console.warn(`[${new Date().toISOString()}] Scan path does not exist on disk, skipping: ${includePath}`);
    }
  }

  if (skippedCount > 0) {
    console.log(`${new Date().toLocaleString()} Skipped ${skippedCount} already-synced SRT files`);
  }

  return { files, skippedCount };
}
