import { basename } from 'path';
import { findMatchingVideoFile } from './findMatchingVideoFile';
import { generateAutosubsyncSubtitles } from './generateAutosubsyncSubtitles';
import { generateFfsubsyncSubtitles } from './generateFfsubsyncSubtitles';
import { generateAlassSubtitles } from './generateAlassSubtitles';

export const processSrtFile = async (srtFile: string) => {
  const videoFile = findMatchingVideoFile(srtFile);
  const includeEngines = process.env.INCLUDE_ENGINES?.split(',') || ['ffsubsync', 'autosubsync', 'alass'];

  if (videoFile) {
    const tasks: Promise<void>[] = [];

    if (includeEngines.includes('ffsubsync')) {
      tasks.push(
        generateFfsubsyncSubtitles(srtFile, videoFile)
          .then((result) => {
            console.log(`${new Date().toLocaleString()} ffsubsync result: ${result.message}`);
          })
          .catch((error) => {
            console.error(`${new Date().toLocaleString()} ffsubsync error:`, error);
          }),
      );
    }
    if (includeEngines.includes('autosubsync')) {
      tasks.push(
        generateAutosubsyncSubtitles(srtFile, videoFile)
          .then((result) => {
            console.log(`${new Date().toLocaleString()} autosubsync result: ${result.message}`);
          })
          .catch((error) => {
            console.error(`${new Date().toLocaleString()} autosubsync error:`, error);
          }),
      );
    }
    if (includeEngines.includes('alass')) {
      tasks.push(
        generateAlassSubtitles(srtFile, videoFile)
          .then((result) => {
            console.log(`${new Date().toLocaleString()} alass result: ${result.message}`);
          })
          .catch((error) => {
            console.error(`${new Date().toLocaleString()} alass error:`, error);
          }),
      );
    }

    await Promise.allSettled(tasks);
  } else {
    console.log(`${new Date().toLocaleString()} No matching video file found for: ${basename(srtFile)}`);
  }
};
