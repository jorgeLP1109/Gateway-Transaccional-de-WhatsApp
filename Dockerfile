FROM node:22-alpine AS dependencies

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json server.js sessionManager.js ./
RUN mkdir -p /app/sessions \
    && chown node:node /app/sessions

USER node

EXPOSE 3000
CMD ["node", "server.js"]