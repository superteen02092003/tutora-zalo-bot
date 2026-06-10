FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Vietnamese-capable fonts for @napi-rs/canvas (tutor card rendering)
RUN apk add --no-cache font-noto fontconfig && fc-cache -f
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
CMD ["node", "dist/main"]
