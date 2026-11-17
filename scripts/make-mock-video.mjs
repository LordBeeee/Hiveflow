import ffmpeg from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const destination = fileURLToPath(
  new URL('../apps/api/assets/mock-video.mp4', import.meta.url),
);
mkdirSync(fileURLToPath(new URL('../apps/api/assets/', import.meta.url)), {
  recursive: true,
});
const result = spawnSync(
  ffmpeg,
  [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=24',
    '-t',
    '2',
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-crf',
    '30',
    '-movflags',
    '+faststart',
    destination,
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.status !== 0 || statSync(destination).size >= 300000)
  throw new Error('MP4 fixture generation failed');
