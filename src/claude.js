import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

// Инструмент, через который Claude вернёт строго структурированный результат.
const SAVE_TOOL = {
  name: 'save_analysis',
  description: 'Сохранить структурированный анализ видео',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Одна папка для видео (1-2 слова)' },
      tags: { type: 'array', items: { type: 'string' }, description: '3-6 тегов' },
      description: { type: 'string', description: 'Суть видео в 1-2 предложениях' },
      products: { type: 'array', items: { type: 'string' }, description: 'Товары/артикулы, если есть' },
      locations: { type: 'array', items: { type: 'string' }, description: 'Места/города/рестораны, если есть' },
    },
    required: ['category', 'tags', 'description'],
  },
};

function buildText(meta, transcript, existingFolders) {
  const folderList = existingFolders.length
    ? existingFolders.join(', ')
    : 'Рецепты, Интерьер, Путешествия, Профессионал, Личное';

  return `Проанализируй видео по кадрам (изображения ниже), описанию и субтитрам.

Контекст:
- Заголовок: ${meta.title}
- Описание: ${meta.description?.slice(0, 1000) || '(нет)'}
- Автор: ${meta.uploader || '(неизвестен)'}
- Субтитры: ${transcript ? transcript.slice(0, 3000) : '(недоступны)'}

Задачи:
1. Определи ОДНУ папку. По возможности выбери из существующих: ${folderList}. Если ни одна не подходит — предложи новую короткую (1-2 слова).
2. Дай 3-6 тегов.
3. Кратко опиши суть.
4. Если на кадрах/в тексте видны товары или артикулы (Ozon, WB) — перечисли.
5. Если упоминаются места/рестораны/города — перечисли.

Верни результат через инструмент save_analysis. Отвечай на русском.`;
}

/**
 * Анализ видео: кадры (base64 jpeg) + текстовый контекст → структурированный JSON.
 * @param {{meta:object, frames:string[], transcript:string, existingFolders:string[]}} args
 */
export async function analyzeVideo({ meta, frames, transcript = '', existingFolders = [] }) {
  const imageBlocks = frames.map((data) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data },
  }));

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [SAVE_TOOL],
    tool_choice: { type: 'tool', name: 'save_analysis' }, // форсируем структурированный вывод
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: buildText(meta, transcript, existingFolders) }, ...imageBlocks],
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Claude не вернул структурированный ответ');
  return toolUse.input;
}
