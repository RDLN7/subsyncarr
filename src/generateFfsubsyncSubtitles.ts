import { basename, dirname, join } from 'path';
import { execPromise, ProcessingResult } from './helpers';
import { existsSync } from 'fs';
import { rename } from 'fs/promises';

export async function generateFfsubsyncSubtitles(srtPath: string, videoPath: string): Promise<ProcessingResult> {
  const directory = dirname(srtPath);
  const srtBaseName = basename(srtPath, '.srt');
  const outputPath = join(directory, `${srtBaseName}.ffsubsync.srt`);
  const overwrite = process.env.OVERWRITE_ORIGINAL === 'true';

  // Check if synced subtitle already exists (only if not overwriting)
  if (!overwrite) {
    const exists = existsSync(outputPath);
    if (exists) {
      return {
        success: true,
        message: `Skipping ${outputPath} - already processed`,
      };
    }
  }

  try {
    const command = `ffsubsync "${videoPath}" -i "${srtPath}" -o "${outputPath}"`;
    console.log(`${new Date().toLocaleString()} Processing: ${command}`);
    await execPromise(command);

    if (overwrite) {
      await rename(outputPath, srtPath);
      return {
        success: true,
        message: `Successfully processed and overwritten: ${srtPath}`,
      };
    }

    return {
      success: true,
      message: `Successfully processed: ${outputPath}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Error processing ${outputPath}: ${errorMessage}`,
    };
  }
}
