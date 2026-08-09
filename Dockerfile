FROM node:22-slim
WORKDIR /app
COPY . .
ENV PORT=8080 KIVO_DATA_DIR=/data KIVO_UPLOAD_DIR=/data/uploads SECURE_COOKIES=true
RUN mkdir -p /data/uploads
EXPOSE 8080
CMD ["node","--no-warnings","server.js"]
