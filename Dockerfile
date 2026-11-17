# Mockup Studio, productie-image.
#   docker build -t mockup-studio .
#   docker run -p 3000:3000 -v mockup-data:/data --env-file .env mockup-studio
ARG NODE_VERSION=26

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx nuxt build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    NUXT_DATA_DIR=/data \
    NUXT_FIXTURES_DIR=/app/fixtures \
    PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=build /app/fixtures ./fixtures
# Chromium voor website-import, in dezelfde versie als playwright-core, met de systeembibliotheken.
RUN PW=$(node -p "require('./.output/server/node_modules/playwright-core/package.json').version") \
 && npx -y "playwright@${PW}" install --with-deps --only-shell chromium \
 && rm -rf /root/.npm /var/lib/apt/lists/* \
 && mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
