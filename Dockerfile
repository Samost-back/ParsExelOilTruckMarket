# Multi-stage build для Node + sharp.
# sharp потребує libvips на runtime, але офіційний sharp >= 0.33 вже включає bundled binary,
# тому слабких/маленьких alpine-варіантів достатньо.

# ============ Builder stage ============
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Системні залежності для нативних модулів (bcrypt, sharp).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ============ Runtime stage ============
FROM node:20-bookworm-slim

WORKDIR /app

# Тонке середовище: тільки потрібні lib для sharp/bcrypt + шрифти з кирилицею
# (потрібні librsvg для рендерингу SVG-тексту через sharp.composite).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini \
      fonts-dejavu-core fonts-liberation \
      fontconfig \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Тягнемо node_modules з builder
COPY --from=builder /app/node_modules ./node_modules

# Код
COPY . .

# Папки для рантайму (uploads/storage можна замаунтити томом)
RUN mkdir -p uploads photos_storage \
    && chown -R app:app /app

USER app

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/web/server.js"]
