import { basename, dirname, join } from 'path';
import {
  calculateSrtOffsetFromContents,
  execPromise,
  extractAudioToWav,
  findOrExtractReferenceSubtitle,
  getTimeoutMs,
  ProcessingResult,
} from './helpers';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { rename } from 'fs/promises';
import { getAppSetting } from './settings';

export async function generateFfsubsyncSubtitles(
  srtPath: string,
  videoPath: string,
  overwriteOriginal: boolean = getAppSetting('OVERWRITE_ORIGINAL') === 'true',
): Promise<ProcessingResult> {
  const directory = dirname(srtPath);
  const srtBaseName = basename(srtPath, '.srt');
  const outputPath = join(directory, `${srtBaseName}.ffsubsync.srt`);
  const overwrite = overwriteOriginal;

  if (!overwrite) {
    const exists = existsSync(outputPath);
    if (exists) {
      return {
        success: true,
        message: `Skipping ${outputPath} - already processed`,
        skipped: true,
      };
    }
  }

  let extractedRefToClean: string | null = null;

  try {
    const { refPath, isSubRef, isExtracted } = await findOrExtractReferenceSubtitle(srtPath, videoPath);
    if (isExtracted) {
      extractedRefToClean = refPath;
    }

    const origContent = existsSync(srtPath) ? readFileSync(srtPath, 'utf-8') : null;
    const command = `ffsubsync "${refPath}" -i "${srtPath}" -o "${outputPath}"`;
    const refSourceText = isSubRef
      ? isExtracted
        ? 'using extracted embedded sub'
        : `using subtitle ref: ${basename(refPath)}`
      : 'using video';
    console.log(`${new Date().toLocaleString()} Processing ffsubsync (${refSourceText}): ${command}`);
    const timeoutMs = isSubRef ? 60000 : getTimeoutMs();
    let stdout = '';
    let stderr = '';

    try {
      const res = await execPromise(command, timeoutMs);
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (primaryError) {
      // If direct video processing with ffsubsync failed, extract a 16kHz mono WAV audio reference file
      const isVideoFile = !isSubRef && refPath === videoPath;
      if (isVideoFile && existsSync(videoPath)) {
        const tempWavPath = join(directory, `${srtBaseName}.ref_audio.wav`);
        console.log(`${new Date().toLocaleString()} FFsubsync direct video processing failed. Extracting WAV audio reference to ${tempWavPath}...`);
        try {
          await extractAudioToWav(videoPath, tempWavPath, 600000);

          if (existsSync(tempWavPath)) {
            const wavCmd = `ffsubsync "${tempWavPath}" -i "${srtPath}" -o "${outputPath}"`;
            console.log(`${new Date().toLocaleString()} Retrying ffsubsync with extracted WAV audio: ${wavCmd}`);
            const res = await execPromise(wavCmd, timeoutMs);
            stdout = res.stdout;
            stderr = res.stderr;
          } else {
            throw primaryError;
          }
        } finally {
          if (existsSync(tempWavPath)) {
            try {
              unlinkSync(tempWavPath);
            } catch {
              /* ignore */
            }
          }
        }
      } else {
        throw primaryError;
      }
    }

    const syncedContent = existsSync(outputPath) ? readFileSync(outputPath, 'utf-8') : null;
    const offsetInfo = calculateSrtOffsetFromContents(origContent, syncedContent);

    if (overwrite) {
      if (existsSync(outputPath)) {
        await rename(outputPath, srtPath);
        return {
          success: true,
          message: `Successfully processed and overwritten: ${srtPath}${offsetInfo ? ` (shift: ${offsetInfo.offset})` : ''}`,
          offset: offsetInfo?.offset,
          offsetSeconds: offsetInfo?.offsetSeconds,
          stdout: stdout || undefined,
          stderr: stderr || undefined,
        };
      }

      return {
        success: false,
        message: `Error: Output file ${outputPath} was not created by ffsubsync`,
        stdout: stdout || undefined,
        stderr: stderr || undefined,
      };
    }

    return {
      success: true,
      message: `Successfully processed: ${outputPath}${offsetInfo ? ` (shift: ${offsetInfo.offset})` : ''}`,
      offset: offsetInfo?.offset,
      offsetSeconds: offsetInfo?.offsetSeconds,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes('SIGTERM') || errorMessage.includes('timed out');

    const execError = error as { stdout?: string; stderr?: string };
    const stdout = execError.stdout || '';
    const stderr = execError.stderr || '';

    if (isTimeout) {
      return {
        success: false,
        message: `Timeout: ${outputPath} took longer than allowed timeout`,
        stdout: stdout || undefined,
        stderr: stderr || undefined,
      };
    }

    return {
      success: false,
      message: `Error processing ${outputPath}: ${errorMessage}`,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
    };
  } finally {
    if (extractedRefToClean && existsSync(extractedRefToClean)) {
      try {
        unlinkSync(extractedRefToClean);
      } catch {
        /* ignore */
      }
    }
  }
}
