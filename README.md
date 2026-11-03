# سيستم 1

الاستشاري والباحث وصانع المنتجات والعلامات والترند. من أنظمة Zaki AI.

المرجع الكامل بمجلد `docs/` (ابدأ من `docs/INDEX.md`).

## كيف أشغّل
1. انسخ `.env.example` لملف اسمه `.env`.
2. عبّي بإيدك: `POSTGRES_PASSWORD` و`S3_ACCESS_KEY` و`S3_SECRET_KEY` (أي كلمات سر قوية).
3. شغّل:

```bash
docker compose up -d --build
```

4. افتح http://localhost:3000 . والصحة: http://localhost:3000/api/health

## كيف أوقف

```bash
docker compose down
```

## كيف أجرّب (للمطوّر)

```bash
npm ci
npm run typecheck
npm run secrets
npm test
npm run test:e2e
```

## كيف آخذ نسخة احتياطية
السكربت اليومي (الساعة 3 الفجر) بيجي مع مهمة B20. لحد هيك، لنسخة يدوية للقاعدة:

```bash
docker compose exec postgres pg_dump -U zaki zaki_s1 > backups/zaki_s1.sql
```

## الشحن
`main` محمي. كل شغل بفرع وطلب دمج، والدمج تلقائي بعد نجاح الفحص، وكل دمج بينشر على كوليفاي.
