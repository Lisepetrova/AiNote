import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdirSync, existsSync, statSync, readFileSync, readdirSync, rmSync,
} from 'node:fs';
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

/** Метаданные без скачивания: { platform, title, description, uploader, duration } */
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
    duration: meta.duration || 30,
  };
}

/** Скачивает видео (низкое разрешение — для кадров хватит). { path, size } */
export async function downloadVideo(url, id) {
  const platform = detectPlatform(url);
  const outPath = join(TMP_DIR, `${id}.mp4`);
  const args = [
    '-f', 'best[height<=480][ext=mp4]/best[height<=480]/best',
    '--no-warnings', '--no-playlist',
    '-o', outPath,
    ...cookieArgs(platform),
    url,
  ];
  await run('yt-dlp', args, { maxBuffer: 1024 * 1024 * 20 });
  if (!existsSync(outPath)) throw new Error('yt-dlp не смог скачать видео (проверьте ссылку/cookies)');
  return { path: outPath, size: statSync(outPath).size };
}

/**
 * Вырезает N кадров, равномерно распределённых по длительности.
 * Возвращает массив base64-строк (jpeg).
 */
export async function extractKeyframes(videoPath, duration, count = 4) {
  const frames = [];
  const dur = Math.max(duration || 30, 4);
  for (let i = 1; i <= count; i++) {
    const t = (dur * i) / (count + 1); // 20%, 40%, 60%, 80% при count=4
    const framePath = `${videoPath}.frame${i}.jpg`;
    try {
      await run('ffmpeg', [
        '-ss', String(t.toFixed(2)),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', 'scale=768:-1',   // ужимаем — экономим токены Claude
        '-q:v', '4',
        '-y', framePath,
      ]);
      if (existsSync(framePath)) {
        frames.push(readFileSync(framePath, { encoding: 'base64' }));
        rmSync(framePath, { force: true });
      }
    } catch {
      // пропускаем неудачный кадр
    }
  }
  if (frames.length === 0) throw new Error('ffmpeg не смог вырезать ни одного кадра');
  return frames;
}

/**
 * Транскрипт для YouTube через авто-субтитры (бесплатно, без Whisper).
 * Для остальных платформ возвращает '' — в MVP анализ идёт по кадрам и описанию.
 */
export async function fetchTranscript(url, id) {
  if (detectPlatform(url) !== 'youtube') return '';
  const base = join(TMP_DIR, `${id}.sub`);
  try {
    await run('yt-dlp', [
      '--skip-download',
      '--write-auto-subs',
      '--sub-langs', 'ru,en',
      '--sub-format', 'vtt',
      '--no-warnings',
      '-o', base,
      url,
    ]);
    const vtt = readdirSync(TMP_DIR).find((f) => f.startsWith(`${id}.sub`) && f.endsWith('.vtt'));
    if (!vtt) return '';
    const raw = readFileSync(join(TMP_DIR, vtt), 'utf8');
    rmSync(join(TMP_DIR, vtt), { force: true });
    // Чистим VTT: убираем таймкоды, теги, дубли строк
    const lines = raw
      .split('\n')
      .filter((l) => l && !/^\d{2}:\d{2}/.test(l) && !/-->/.test(l) && l !== 'WEBVTT')
      .map((l) => l.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);
    return [...new Set(lines)].join(' ').slice(0, 4000);
  } catch {
    return '';
  }
}
