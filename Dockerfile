# Node 22 на Debian (есть apt для установки ffmpeg и yt-dlp)
FROM node:22-bookworm-slim

# Системные зависимости: ffmpeg + yt-dlp (через pip)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Сначала манифесты — для кеша слоёв
COPY package*.json ./
RUN npm install --omit=dev

# Затем весь код
COPY . .

# Railway сам задаёт PORT через переменную окружения
CMD ["node", "server.js"]
