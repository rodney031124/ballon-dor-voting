FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY app.js ./
COPY views ./views
COPY public ./public

USER node
EXPOSE 8080

CMD ["npm", "start"]
