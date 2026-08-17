import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/init.js';

const router = express.Router();

const DEFAULT_FOLDERS = [
  { name: 'Рецепты', emoji: '🍕' },
  { name: 'Интерьер', emoji: '🏠' },
  { name: 'Путешествия', emoji: '✈️' },
  { name: 'Профессионал', emoji: '💼' },
  { name: 'Личное', emoji: '🎯' },
];

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

router.post('/register', (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }

    const existing = db
      .prepare('SELECT id FROM users WHERE email = ? OR username = ?')
      .get(email, username);
    if (existing) return res.status(400).json({ error: 'Email или username заняты' });

    const userId = uuidv4();
    const hash = bcrypt.hashSync(password, 10);

    const createUser = db.prepare(
      'INSERT INTO users (id, email, username, password) VALUES (?, ?, ?, ?)'
    );
    const createFolder = db.prepare(
      'INSERT INTO folders (id, userId, name, emoji) VALUES (?, ?, ?, ?)'
    );

    const tx = db.transaction(() => {
      createUser.run(userId, email, username, hash);
      for (const f of DEFAULT_FOLDERS) {
        createFolder.run(uuidv4(), userId, f.name, f.emoji);
      }
    });
    tx();

    res.json({ token: signToken(userId), user: { id: userId, email, username } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    res.json({
      token: signToken(user.id),
      user: { id: user.id, email: user.email, username: user.username },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/me', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Нет токена' });
  try {
    const { userId } = jwt.verify(token, process.env.JWT_SECRET);
    const user = db
      .prepare('SELECT id, email, username, createdAt FROM users WHERE id = ?')
      .get(userId);
    res.json(user);
  } catch {
    res.status(401).json({ error: 'Невалидный токен' });
  }
});

export default router;
