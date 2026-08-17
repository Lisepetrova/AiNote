import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/init.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Все папки пользователя со счётчиком видео
router.get('/', authMiddleware, (req, res) => {
  try {
    const folders = db
      .prepare(`
        SELECT f.*, COUNT(b.id) AS videoCount
        FROM folders f
        LEFT JOIN bookmarks b ON b.folderId = f.id
        WHERE f.userId = ?
        GROUP BY f.id
        ORDER BY f.name ASC
      `)
      .all(req.userId);
    res.json(folders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Видео внутри папки
router.get('/:id/bookmarks', authMiddleware, (req, res) => {
  try {
    const folder = db
      .prepare('SELECT * FROM folders WHERE id = ? AND userId = ?')
      .get(req.params.id, req.userId);
    if (!folder) return res.status(404).json({ error: 'Папка не найдена' });

    const rows = db
      .prepare('SELECT * FROM bookmarks WHERE folderId = ? ORDER BY createdAt DESC')
      .all(req.params.id);

    const bookmarks = rows.map((b) => ({ ...b, analysis: JSON.parse(b.analysis || '{}') }));
    res.json({ folder, bookmarks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Создать папку
router.post('/', authMiddleware, (req, res) => {
  try {
    const { name, emoji, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Имя папки обязательно' });

    const id = uuidv4();
    db.prepare('INSERT INTO folders (id, userId, name, emoji, color) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.userId, name, emoji || '📁', color || '#3b82f6');

    res.json({ id, name, emoji: emoji || '📁', color: color || '#3b82f6', videoCount: 0 });
  } catch (error) {
    // UNIQUE(userId, name) может выстрелить — обрабатываем аккуратно
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Папка с таким именем уже есть' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Удалить папку (видео из неё уходят в корень)
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const folder = db
      .prepare('SELECT * FROM folders WHERE id = ? AND userId = ?')
      .get(req.params.id, req.userId);
    if (!folder) return res.status(404).json({ error: 'Папка не найдена' });

    db.prepare('DELETE FROM folders WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
