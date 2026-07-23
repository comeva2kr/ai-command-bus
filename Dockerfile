# Personalized feed server — zero-dependency Node app.
FROM node:22-alpine

WORKDIR /app

# Only source is needed; there are no dependencies to install.
COPY package.json ./
COPY src ./src

ENV PORT=4000
EXPOSE 4000

# FEED_DB (persist users), FEED_LIVE=1 (live ingestion), FEED_REFRESH_MS,
# and VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY (web push) can be set at runtime.
CMD ["node", "src/feed/server.js"]
