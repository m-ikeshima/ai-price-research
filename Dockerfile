FROM node:20-alpine

WORKDIR /app

# 依存先のインストール
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# アプリ本体
COPY server.js ./
COPY public ./public

# Render / Fly.io / Railway などが渡す PORT を尊重
ENV PORT=8787
EXPOSE 8787

CMD ["node", "server.js"]
