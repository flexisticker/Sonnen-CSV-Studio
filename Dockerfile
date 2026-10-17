# Steuer-Studio (früher Sonnen-CSV-Studio) – Unterlagen für Steuerberater und Finanzamt, für Unraid
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    IMPORT_DIR=/import \
    TZ=Europe/Berlin
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY public ./public
ARG APP_VERSION=
ARG APP_BUILD=
ARG APP_COMMIT=
ENV APP_VERSION=$APP_VERSION APP_BUILD=$APP_BUILD APP_COMMIT=$APP_COMMIT
# Unraid: WebUI-Eintrag im Container-Menü und Icon
LABEL net.unraid.docker.webui="http://[IP]:[PORT:8080]/" \
      net.unraid.docker.icon="https://raw.githubusercontent.com/flexisticker/Sonnen-CSV-Studio/main/public/icon.png" \
      org.opencontainers.image.title="Steuer-Studio" \
      org.opencontainers.image.source="https://github.com/flexisticker/Sonnen-CSV-Studio"
EXPOSE 8080
VOLUME ["/data", "/import"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
