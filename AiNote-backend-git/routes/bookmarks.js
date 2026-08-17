import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/init.js';
import { authMiddleware } from '../middleware/auth.js';
import { rmSync } from 'node:fs';
import {
  detectPlatform, fetchMetadata, downloadVideo, extractKeyframes, fetchTranscript,
} from '../src/extract.js';
import { analyzeVideo } from '../src/claude.js';

const router = express.Router();
const KEYFRAMES = Number(process.env.KEYFRAMES) || 4;

/**
 * Фоновая обработка: метаданные → скачать → кадры (ffmpeg) → субтитры →
 * Claude анализирует кадры+текст → раскладка по папке.
 * Обновляет строку закладки по завершении. Ошибки пишет в status='error'.
 */
async function processVideo(bookmarkId, userId, url) {
  let localFile = null;
  try {
    const platform = detectPlatform(url);
    const meta = await fetchMetadata(url);

    // Существующие папки пользователя — чтобы Claude клал в них, а не плодил дубликаты
    const existingFolders = db
      .prepare('SELECT name FROM folders WHERE userId = ?')
      .all(userId)
      .map((r) => r.name);

    // Claude не смотрит видео — нужны кадры. Качаем и режем ffmpeg-ом.
    localFile = await downloadVideo(url, bookmarkId); // { path, size }
    const frames = await extractKeyframes(localFile.path, meta.duration, KEYFRAMES);
    const transcript = await fetchTranscript(url, bookmarkId); // текст только для YouTube

    const analysis = await analyzeVideo({ meta, frames, transcript, existingFolders });

    // Находим папку по имени (без учёта регистра) или создаём новую
    let folder = db
      .prepare('SELECT id FROM folders WHERE userId = ? AND lower(name) = lower(?)')
      .get(userId, analysis.category);

    if (!folder) {
      const folderId = uuidv4();
      db.prepare('INSERT INTO folders (id, userId, name) VALUES (?, ?, ?)')
        .run(folderId, userId, analysis.category);
      folder = { id: folderId };
    }

    db.prepare(`
      UPDATE bookmarks
      SET title = ?, folderId = ?, platform = ?, analysis = ?, status = 'ready',
          updatedAt = datetime('now')
      WHERE id = ?
    `).run(meta.title, folder.id, platform, JSON.stringify(analysis), bookmarkId);
  } catch (error) {
    console.error(`Ошибка обработки ${bookmarkId}:`, error.message);
    db.prepare(`
      UPDATE bookmarks
      SET status = 'error', analysis = ?, updatedAt = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify({ error: error.message }), bookmarkId);
  } finally {
    if (localFile?.path) {
      try { rmSync(localFile.path, { force: true }); } catch { /* уже удалён */ }
    }
  }
}

// Добавить закладку — возвращает сразу, обработка идёт в фоне
router.post('/', authMiddleware, (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ error: 'URL видео обязателен' });

    const bookmarkId = uuidv4();
    db.prepare(`
      INSERT INTO bookmarks (id, userId, videoUrl, platform, status)
      VALUES (?, ?, ?, ?, 'processing')
    `).run(bookmarkId, req.userId, videoUrl, detectPlatform(videoUrl));

    // Не блокируем ответ — мобильное приложение обновит список по pull-to-refresh
    processVideo(bookmarkId, req.userId, videoUrl);

    res.json({ bookmarkId, status: 'processing' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Все закладки пользователя
router.get('/', authMiddleware, (req, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM bookmarks WHERE userId = ? ORDER BY createdAt DESC')
      .all(req.userId);
    res.json(rows.map((b) => ({ ...b, analysis: JSON.parse(b.analysis || '{}') })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Одна закладка (для опроса статуса)
router.get('/:id', authMiddleware, (req, res) => {
  try {
    const b = db
      .prepare('SELECT * FROM bookmarks WHERE id = ? AND userId = ?')
      .get(req.params.id, req.userId);
    if (!b) return res.status(404).json({ error: 'Закладка не найдена' });
    res.json({ ...b, analysis: JSON.parse(b.analysis || '{}') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Переместить в другую папку
router.patch('/:id/move', authMiddleware, (req, res) => {
  try {
    const { folderId } = req.body;
    const b = db
      .prepare('SELECT id FROM bookmarks WHERE id = ? AND userId = ?')
      .get(req.params.id, req.userId);
    if (!b) return res.status(404).json({ error: 'Закладка не найдена' });

    const folder = db
      .prepare('SELECT id FROM folders WHERE id = ? AND userId = ?')
      .get(folderId, req.userId);
    if (!folder) return res.status(403).json({ error: 'Папка не найдена' });

    db.prepare("UPDATE bookmarks SET folderId = ?, updatedAt = datetime('now') WHERE id = ?")
      .run(folderId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Удалить
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const info = db
      .prepare('DELETE FROM bookmarks WHERE id = ? AND userId = ?')
      .run(req.params.id, req.userId);
    if (info.changes === 0) return res.status(404).json({ error: 'Закладка не найдена' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
