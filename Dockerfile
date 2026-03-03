FROM node:22-bookworm

WORKDIR /app

ENV NODE_ENV=development
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update && apt-get install -y --no-install-recommends \
  libglib2.0-0 \
  libnss3 \
  libnspr4 \
  libdbus-1-3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libatspi2.0-0 \
  libcups2 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libxshmfence1 \
  libasound2 \
  libpango-1.0-0 \
  libcairo2 \
  libgtk-3-0 \
  libx11-6 \
  libxcb1 \
  ca-certificates \
  fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# Install all deps (including dev for build). We need lifecycle scripts enabled so native/runtime
# artifacts used by scoring dependencies (for example sharp via transformers) are properly installed.
RUN npm ci --include=dev

# Ensure Chromium is present for Playwright rendering.
RUN npx playwright install chromium

COPY . .

RUN npm run build

# Drop dev dependencies for runtime image size and security.
RUN npm prune --omit=dev

ENV NODE_ENV=production

EXPOSE 8080

CMD ["npm", "start"]
