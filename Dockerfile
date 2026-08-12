FROM node:22-slim

WORKDIR /app
COPY . .

ENV PORT=8080 \
    KIVO_DATA_DIR=/data \
    KIVO_UPLOAD_DIR=/data/uploads \
    KIVO_LOCAL_DESKTOP=false \
    KIVO_UPDATE_REPO=kumaylalrahal2009-debug/Kivo-Updates \
    SECURE_COOKIES=true \
    NODE_ENV=production

RUN mkdir -p /data/uploads /app/backups /app/updates \
    && chown -R node:node /app /data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/admin/me').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node","--no-warnings","secure-gateway.js"]
