import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const run = promisify(execFile);
const TMP_DIR = process.env.TMP_DIR || './tmp';
mkdirSync(TMP_DIR, { recursive: true });

export function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/vimeo\.com/i.test(url)) return 'vimeo';
  return 'unknown';
}

function cookieArgs(platform) {
  if (platform === 'instagram' && process.env.IG_COOKIES_PATH) {
    return ['--cookies', process.env.IG_COOKIES_PATH, '--sleep-requests', '2'];
  }
  return [];
}

// Метаданные без скачивания
export async function fetchMetadata(url) {
  const platform = detectPlatform(url);
  const args = ['--dump-single-json', '--no-warnings', '--no-playlist', ...cookieArgs(platform), url];
  const { stdout } = await run('yt-dlp', args, { maxBuffer: 1024 * 1024 * 20 });
  const meta = JSON.parse(stdout);
  return {
    platform,
    title: meta.title || meta.description?.slice(0, 80) || 'Без названия',
    description: meta.description || '',
    uploader: meta.uploader || meta.channel || '',
    duration: meta.duration || null,
  };
}

// Скачивание видео (нужно только для TikTok/Instagram; YouTube идёт в Gemini напрямую)
export async function downloadVideo(url, id) {
  const platform = detectPlatform(url);
  const outPath = join(TMP_DIR, `${id}.mp4`);
  const args = [
    '-f', 'mp4/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
    '--merge-output-format', 'mp4',
    '--no-warnings', '--no-playlist',
    '-o', outPath,
    ...cookieArgs(platform),
    url,
  ];
  await run('yt-dlp', args, { maxBuffer: 1024 * 1024 * 20 });
  if (!existsSync(outPath)) throw new Error('yt-dlp не смог скачать видео (проверьте ссылку/cookies)');
  return { path: outPath, size: statSync(outPath).size };
}
