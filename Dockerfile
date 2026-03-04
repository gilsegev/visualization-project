FROM node:22-bookworm

WORKDIR /app

ENV NODE_ENV=development
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ARG D2_VERSION=0.7.1

RUN apt-get update && apt-get install -y --no-install-recommends \
  curl \
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

# Install D2 CLI for flowchart/timeline/process_map rendering.
RUN set -eux; \
  arch="$(dpkg --print-architecture)"; \
  case "$arch" in \
    amd64) d2_arch='amd64' ;; \
    arm64) d2_arch='arm64' ;; \
    *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
  esac; \
  curl -fsSL -o /tmp/d2.tgz "https://github.com/terrastruct/d2/releases/download/v${D2_VERSION}/d2-v${D2_VERSION}-linux-${d2_arch}.tar.gz"; \
  tar -xzf /tmp/d2.tgz -C /tmp; \
  install -m 0755 "/tmp/d2-v${D2_VERSION}/bin/d2" /usr/local/bin/d2; \
  d2 --version; \
  rm -rf /tmp/d2.tgz "/tmp/d2-v${D2_VERSION}"

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
