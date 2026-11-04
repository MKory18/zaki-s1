# صورة سيستم 1: هدفين من نفس الملف. app للموقع، وworker للطابور والجدولة والترحيل.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# عميل قاعدة البيانات بيتولّد وقت البناء (مش مرفوع بجيت)
RUN npx prisma generate && mkdir -p public && npm run build

# ── الموقع والـ API: مجلد standalone بس، صورة صغيرة ──
FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=Asia/Amman
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]

# ── العامل: بيطبّق ترحيل القاعدة والبذور أول ما يشتغل (آمنين للتكرار)، وبعدين بيبدأ شغله ──
FROM node:22-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Amman
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY package.json tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY worker ./worker
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx worker/index.ts"]
