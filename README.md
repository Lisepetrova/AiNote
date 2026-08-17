# AiNote Backend (Claude)

Backend для видео-закладок с ИИ-категоризацией на **Claude**.

## Как это работает

```
Ссылка на видео
  → yt-dlp: метаданные + скачивание (низкое разрешение) + субтитры (YouTube)
  → ffmpeg: вырезает N кадров, равномерно по длительности
  → Claude: анализирует КАДРЫ + описание + субтитры (tool-use → строгий JSON)
  → {category, tags, description, products, locations}
  → раскладка по папке (существующей или новой)
```

Важно: Claude **не смотрит видео** — только текст и изображения. Поэтому кадры режет
ffmpeg. Аудио-транскрипция для TikTok/Instagram в MVP не делается (это был бы Whisper);
для YouTube берутся бесплатные авто-субтитры. Анализ TikTok/Instagram идёт по кадрам и
описанию — этого достаточно для категоризации, но нюансы из речи могут теряться.

Мобильное приложение (Expo) общается только с этим backend — при смене ИИ-провайдера
его трогать не нужно.

## Требования

- **Node.js 20+**
- **yt-dlp** в PATH: `pip install -U yt-dlp` (обновляйте регулярно)
- **ffmpeg** в PATH: `apt install ffmpeg` / `brew install ffmpeg`
- Ключ **Claude API** из https://console.anthropic.com

## Установка

```bash
npm install
cp .env.example .env      # впишите ANTHROPIC_API_KEY и JWT_SECRET
npm start
```

## Платформы: реалистичные ожидания

| Платформа  | Надёжность | Примечание |
|------------|-----------|-----------|
| YouTube    | высокая   | + бесплатные авто-субтитры как транскрипт |
| TikTok     | хорошая   | публичные видео без cookies; анализ по кадрам |
| Instagram  | средняя   | **нужен `IG_COOKIES_PATH`**; рилсы иногда отдают пустой ответ; не гоняйте частые запросы через личный аккаунт |

## Модель и стоимость

По умолчанию `claude-sonnet-5`. Дешевле для потока — `claude-haiku-4-5-20251001`,
умнее — `claude-opus-4-8` (меняется в `.env` → `CLAUDE_MODEL`). Кадры ужимаются до 768px,
чтобы экономить токены.

## API

| Метод | Путь | Назначение |
|-------|------|-----------|
| POST | `/api/auth/register` | регистрация (создаёт дефолтные папки) |
| POST | `/api/auth/login` | вход |
| GET | `/api/auth/me` | текущий пользователь |
| GET | `/api/folders` | папки со счётчиком видео |
| POST | `/api/folders` | создать папку |
| DELETE | `/api/folders/:id` | удалить папку |
| GET | `/api/folders/:id/bookmarks` | видео в папке |
| POST | `/api/bookmarks` | добавить видео (обработка в фоне) |
| GET | `/api/bookmarks` | все закладки |
| GET | `/api/bookmarks/:id` | одна закладка (для опроса статуса) |
| PATCH | `/api/bookmarks/:id/move` | переместить |
| DELETE | `/api/bookmarks/:id` | удалить |

`POST /api/bookmarks` возвращает `{bookmarkId, status:'processing'}` сразу.
Статус меняется на `ready`/`error` после обработки — приложение видит это по
pull-to-refresh или запросу `GET /api/bookmarks/:id`.

## Подключение телефонов (10 человек)

1. IP компьютера: `ipconfig getifaddr en0` (mac) / `ip addr` (linux) / `ipconfig` (win).
2. В мобильном `.env`: `EXPO_PUBLIC_API_URL=http://ВАШ_IP:3001/api`.
3. Все подключаются к одному backend, каждый регистрируется под своим аккаунтом.

Для прода вне локальной сети нужен HTTPS (iOS ATS / Android блокируют cleartext).
Проще всего туннель: `cloudflared tunnel --url http://localhost:3001`.
