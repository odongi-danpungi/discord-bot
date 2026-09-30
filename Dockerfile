FROM node:22.22.2-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    APP_PROFILE=production \
    HOST=0.0.0.0 \
    PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node . .
RUN mkdir -p /app/data/backups && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node","scripts/healthcheck.js"]
CMD ["node","src/index.js"]
