# FelixPay — Next.js + MongoDB

Project ini sudah dimigrasikan dari Supabase/PostgreSQL ke **MongoDB** dengan mempertahankan route API dan alur aplikasi yang ada.

## Perubahan database

- Supabase/PostgreSQL sudah dihapus dari runtime.
- Dependency Supabase sudah dihapus.
- Database sekarang menggunakan `mongodb` driver.
- Route lama tetap menggunakan interface database compatibility layer agar perubahan di banyak API route tetap minimal dan risiko regresi lebih kecil.
- Operasi penting tetap atomic:
  - potong saldo hanya jika saldo mencukupi
  - refund saldo menggunakan `$inc`
  - cancel deposit hanya jika masih `pending` dan belum expired
  - expire deposit hanya jika masih `pending`
  - credit deposit hanya jika masih `pending`
  - mutation log memakai unique index untuk deduplikasi
- Index MongoDB dibuat otomatis saat aplikasi pertama kali terhubung.

## Environment

Gunakan `.env.example` sebagai template. Minimal isi:

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=felixpay
```

Credential aplikasi lain seperti Telegram, JWT, GoPay, dan H2H tetap menggunakan variabel yang sama seperti project sebelumnya.

**Jangan commit `.env` ke GitHub.** Gunakan secret/environment variables di Vercel.

## MongoDB Atlas

1. Buat cluster MongoDB Atlas.
2. Buat database user.
3. Pada Network Access, izinkan IP yang akan digunakan aplikasi/Vercel.
4. Ambil connection string dari **Connect → Drivers**.
5. Masukkan ke `MONGODB_URI`.
6. Database `felixpay` akan dibuat otomatis ketika aplikasi menulis data.

## Menjalankan

```bash
npm install
npm run dev
```

Production:

```bash
npm run build
npm start
```

## Migrasi JSON lama

Jika masih mempunyai folder `data/*.json` dari project lama:

```bash
npm run migrate
```

Script `scripts/migrate-json-to-mongodb.js` melakukan upsert sehingga dapat dijalankan ulang tanpa membuat duplikat berdasarkan `id`/`username`.

## Catatan deploy Vercel

Pastikan semua environment variable dari `.env` sudah dimasukkan ke **Vercel Project Settings → Environment Variables**.

Untuk MongoDB Atlas, pastikan koneksi dari deployment Vercel diizinkan oleh konfigurasi Network Access Atlas.

## Security

Credential yang pernah masuk ke source code, chat, atau repository sebaiknya di-rotate sebelum production. Jangan menggunakan credential Supabase lama karena project ini sudah tidak membutuhkannya.
