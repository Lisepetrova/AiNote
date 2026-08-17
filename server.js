import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initializeDatabase } from './db/init.js';
import authRoutes from './routes/auth.js';
import folderRoutes from './routes/folders.js';
import bookmarkRoutes from './routes/bookmarks.js';

const app = express();
const PORT = process.env.PORT || 3001;

if (!process.env.GEMINI_API_KEY) {
  console.warn('⚠️  GEMINI_API_KEY не задан — анализ видео работать не будет');
}

initializeDatabase();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/bookmarks', bookmarkRoutes);

app.get('/health', (_req, res) => res.json({ status: 'OK', ts: new Date().toISOString() }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend слушает порт ${PORT}`);
});
