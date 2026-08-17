import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/init.js';
import { authMiddleware } from '../middleware/auth.js';
import { detectPlatform, fetchMetadata, downloadVideo } from '../src/extract.js';
import { analyzeVideo } from '../src/gemini.js';

const router = express.Router();

// Фоновая обработка: метаданные → (скачать, если не YouTube) → Gemini → раскладка по папке
async function processVideo(bookmarkId, userId, url) {
  try {
    const platform = detectPlatform(url);
    const meta = await fetchMetadata(url);

    const existingFolders = db
      .prepare('SELECT name FROM folders WHERE userId = ?')
      .all(userId)
      .map((r) => r.name);

    let localFile = null;
    if (platform !== 'youtube') {
      localFile = await downloadVideo(url, bookmarkId);
    }

    const analysis = await analyzeVideo({ url, platform, meta, localFile, existingFolders });

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
      UPDATE bookmarks SET status = 'error', analysis = ?, updatedAt = datetime('now') WHERE id = ?
    `).run(JSON.stringify({ error: error.message }), bookmarkId);
  }
}

router.post('/', authMiddleware, (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ error: 'URL видео обязателен' });
    const bookmarkId = uuidv4();
    db.prepare(`
      INSERT INTO bookmarks (id, userId, videoUrl, platform, status)
      VALUES (?, ?, ?, ?, 'processing')
    `).run(bookmarkId, req.userId, videoUrl, detectPlatform(videoUrl));
    processVideo(bookmarkId, req.userId, videoUrl);
    res.json({ bookmarkId, status: 'processing' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

router.patch('/:id/move', authMiddleware, (req, res) => {
  try {
    const { folderId } = req.body;
    const b = db.prepare('SELECT id FROM bookmarks WHERE id = ? AND userId = ?')
      .get(req.params.id, req.userId);
    if (!b) return res.status(404).json({ error: 'Закладка не найдена' });
    const folder = db.prepare('SELECT id FROM folders WHERE id = ? AND userId = ?')
      .get(folderId, req.userId);
    if (!folder) return res.status(403).json({ error: 'Папка не найдена' });
    db.prepare("UPDATE bookmarks SET folderId = ?, updatedAt = datetime('now') WHERE id = ?")
      .run(folderId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const info = db.prepare('DELETE FROM bookmarks WHERE id = ? AND userId = ?')
      .run(req.params.id, req.userId);
    if (info.changes === 0) return res.status(404).json({ error: 'Закладка не найдена' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
