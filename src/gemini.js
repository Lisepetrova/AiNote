import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
  Type,
} from '@google/genai';
import { readFileSync, unlinkSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const INLINE_LIMIT = 18 * 1024 * 1024; // <20 МБ можно слать инлайном

// Строгий JSON на выходе — без regex-парсинга.
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    category: { type: Type.STRING, description: 'Одна папка для видео' },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    description: { type: Type.STRING, description: 'Суть видео в 1-2 предложениях' },
    products: { type: Type.ARRAY, items: { type: Type.STRING } },
    locations: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['category', 'tags', 'description'],
};

function buildPrompt(meta, existingFolders) {
  const folderList = existingFolders.length
    ? existingFolders.join(', ')
    : 'Рецепты, Интерьер, Путешествия, Профессионал, Личное';
  return `Проанализируй это видео (визуальный ряд + аудио) и извлеки полезную информацию.

Контекст из соцсети:
- Заголовок: ${meta.title}
- Описание: ${meta.description?.slice(0, 1000) || '(нет)'}
- Автор: ${meta.uploader || '(неизвестен)'}

Задачи:
1. Определи ОДНУ папку. По возможности выбери из существующих: ${folderList}. Если ни одна не подходит — предложи новую короткую (1-2 слова).
2. Дай 3-6 тегов.
3. Кратко опиши суть.
4. Если видны товары/артикулы (Ozon, WB) — перечисли.
5. Если упоминаются места/рестораны/города — перечисли.

Отвечай на русском.`;
}

async function generate(parts, meta, existingFolders) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: createUserContent([buildPrompt(meta, existingFolders), ...parts]),
    config: { responseMimeType: 'application/json', responseSchema },
  });
  return JSON.parse(response.text);
}

// YouTube: URL передаётся напрямую, без скачивания.
async function analyzeYouTube(url, meta, existingFolders) {
  const part = createPartFromUri(url, 'video/*');
  return generate([part], meta, existingFolders);
}

// Малые файлы — инлайн base64.
async function analyzeInline(filePath, meta, existingFolders) {
  const data = readFileSync(filePath, { encoding: 'base64' });
  const part = { inlineData: { mimeType: 'video/mp4', data } };
  return generate([part], meta, existingFolders);
}

// Крупные файлы — File API: загрузка, ожидание ACTIVE, анализ.
async function analyzeUploaded(filePath, meta, existingFolders) {
  let file = await ai.files.upload({ file: filePath, config: { mimeType: 'video/mp4' } });
  const started = Date.now();
  while (file.state === 'PROCESSING') {
    if (Date.now() - started > 120_000) throw new Error('Gemini: обработка файла заняла слишком долго');
    await sleep(3000);
    file = await ai.files.get({ name: file.name });
  }
  if (file.state === 'FAILED') throw new Error('Gemini не смог обработать видео');
  const part = createPartFromUri(file.uri, file.mimeType);
  const result = await generate([part], meta, existingFolders);
  try { await ai.files.delete({ name: file.name }); } catch { /* не критично */ }
  return result;
}

export async function analyzeVideo({ url, platform, meta, localFile, existingFolders = [] }) {
  if (platform === 'youtube') return analyzeYouTube(url, meta, existingFolders);
  if (!localFile) throw new Error('Для этой платформы нужен скачанный файл');
  try {
    if (localFile.size <= INLINE_LIMIT) return await analyzeInline(localFile.path, meta, existingFolders);
    return await analyzeUploaded(localFile.path, meta, existingFolders);
  } finally {
    try { unlinkSync(localFile.path); } catch { /* уже удалён */ }
  }
}
