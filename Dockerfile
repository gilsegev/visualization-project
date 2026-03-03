FROM node:22-bookworm

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package*.json ./

# Install all deps (including dev for build), but skip lifecycle scripts to control Playwright install explicitly.
RUN npm ci --ignore-scripts

# Install Chromium and required OS libraries for Playwright in the image.
RUN npx playwright install --with-deps chromium

COPY . .

RUN npm run build

# Drop dev dependencies for runtime image size and security.
RUN npm prune --omit=dev

EXPOSE 8080

CMD ["npm", "start"]
