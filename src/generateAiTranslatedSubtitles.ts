import { basename, dirname, join } from 'path';
import { existsSync } from 'fs';
import { readFile, readdir, writeFile } from 'fs/promises';
import { ProcessingResult } from './helpers';
import { getAppSetting } from './settings';

interface SubtitleCue {
  timing: string;
  text: string;
}

const targetLanguage = () => getAppSetting('AI_TARGET_LANGUAGE');
const outputLanguage = () => getAppSetting('AI_OUTPUT_LANGUAGE');
const requiredLanguages = () =>
  getAppSetting('AI_REQUIRED_SUBTITLE_LANGUAGES')
    .split(',')
    .map((language) => language.trim())
    .filter(Boolean);
const outputPathFor = (srtPath: string) =>
  join(dirname(srtPath), `${basename(srtPath, '.srt')}.AI.${outputLanguage()}.srt`);

function normalizedLanguage(value: string): string {
  return value.replace(/_/g, '-').toLowerCase();
}

function mediaStem(fileName: string): string {
  const subtitleStem = basename(fileName, '.srt');
  // Treat a final BCP-47-style language tag as metadata, leaving the movie/episode name.
  return subtitleStem.replace(/\.[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i, '');
}

async function hasRequiredSubtitle(srtPath: string): Promise<boolean> {
  const required = requiredLanguages().map(normalizedLanguage);
  if (!required.length) return false;
  const stem = mediaStem(srtPath);
  const names = await readdir(dirname(srtPath));
  return names.some((name) => {
    if (!name.toLowerCase().endsWith('.srt')) return false;
    const candidateStem = mediaStem(name);
    const candidateTag = basename(name, '.srt').slice(candidateStem.length + 1);
    return candidateStem === stem && required.includes(normalizedLanguage(candidateTag));
  });
}

function parseCues(contents: string): SubtitleCue[] {
  return contents
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      if (/^\d+$/.test(lines[0]?.trim() || '')) lines.shift();
      const timing = lines.shift()?.trim();
      return timing && timing.includes('-->') ? { timing, text: lines.join('\n').trim() } : null;
    })
    .filter((cue): cue is SubtitleCue => cue !== null);
}

function batches(cues: SubtitleCue[]): Array<Array<{ index: number; cue: SubtitleCue }>> {
  const maxCues = Math.max(1, Number.parseInt(getAppSetting('AI_BATCH_CUES'), 10));
  const maxChars = Math.max(1000, Number.parseInt(getAppSetting('AI_BATCH_CHARS'), 10));
  const result: Array<Array<{ index: number; cue: SubtitleCue }>> = [];
  let batch: Array<{ index: number; cue: SubtitleCue }> = [];
  let chars = 0;
  cues.forEach((cue, index) => {
    if (batch.length && (batch.length >= maxCues || chars + cue.text.length > maxChars)) {
      result.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push({ index, cue });
    chars += cue.text.length;
  });
  if (batch.length) result.push(batch);
  return result;
}

async function translateBatch(batch: Array<{ index: number; cue: SubtitleCue }>): Promise<Map<number, string>> {
  const apiKey = getAppSetting('AI_API_KEY');
  const baseUrl = getAppSetting('AI_BASE_URL').replace(/\/$/, '');
  const model = getAppSetting('AI_MODEL');
  if (!apiKey || !baseUrl || !model) throw new Error('AI translation requires AI_BASE_URL, AI_API_KEY, and AI_MODEL');

  const expected = new Set(batch.filter(({ cue }) => cue.text).map(({ index }) => index));
  if (!expected.size) return new Map();
  const prompt = `Translate every subtitle line below to ${targetLanguage()}. Keep every [index] exactly. Preserve line breaks inside a translation with \\n. Return exactly one [index] translation per input line and no other text.\n${batch
    .filter(({ cue }) => cue.text)
    .map(({ index, cue }) => `[${index}] ${cue.text.replace(/\n/g, ' ')}`)
    .join('\n')}`;
  const timeoutMs = Math.max(1000, Number.parseInt(getAppSetting('AI_TIMEOUT_MS'), 10));
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: Number.parseInt(getAppSetting('AI_MAX_OUTPUT_TOKENS'), 10),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`AI API request failed: HTTP ${response.status}`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI API response did not contain a translation');
  const translations = new Map<number, string>();
  content.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*\[(\d+)]\s*(.*)$/);
    if (match) translations.set(Number.parseInt(match[1], 10), match[2].replace(/\\n/g, '\n').trim());
  });
  if (translations.size === 0 && expected.size > 0) {
    throw new Error(`AI response was incomplete (0/${expected.size} subtitle cues returned)`);
  }
  if (translations.size < expected.size) {
    console.warn(
      `[${new Date().toISOString()}] AI translation batch partial: ${translations.size}/${expected.size} cues returned. Missing cues will retain original text.`,
    );
  }
  return translations;
}

export async function generateAiTranslatedSubtitles(srtPath: string): Promise<ProcessingResult> {
  const outputPath = outputPathFor(srtPath);
  if (existsSync(outputPath))
    return { success: true, skipped: true, message: `Skipping ${outputPath} - already translated` };
  if (await hasRequiredSubtitle(srtPath)) {
    return {
      success: true,
      skipped: true,
      message: `Skipping AI translation - monitored subtitle language already exists for this media`,
    };
  }
  const source = await readFile(srtPath, 'utf8');
  const cues = parseCues(source);
  if (!cues.length) return { success: false, message: `No valid SRT cues found in ${srtPath}` };
  const translated = new Map<number, string>();
  for (const batch of batches(cues)) {
    for (const [index, text] of await translateBatch(batch)) translated.set(index, text);
  }
  const output =
    cues.map((cue, index) => `${index + 1}\n${cue.timing}\n${translated.get(index) || cue.text}`).join('\n\n') + '\n';
  await writeFile(outputPath, output, 'utf8');
  return { success: true, message: `AI translated ${cues.length} cues to ${outputPath}` };
}

export function getAiTranslationOutputPath(srtPath: string): string {
  return outputPathFor(srtPath);
}

export function getAiSynchronizedOutputPath(srtPath: string, engine: string): string {
  const aiPath = outputPathFor(srtPath);
  return join(dirname(aiPath), `${basename(aiPath, '.srt')}.${engine}.srt`);
}
