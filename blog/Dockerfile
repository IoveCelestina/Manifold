FROM node:22.23.1-alpine3.23 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22.23.1-alpine3.23 AS runner

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY --from=builder --chown=node:node /app/dist/standalone ./

USER node

EXPOSE 3000

CMD ["node", "server.js"]
