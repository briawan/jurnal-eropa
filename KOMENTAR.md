# Komentar & suka per foto — cara menyalakannya

Pengunjung bisa **menyukai** dan **berkomentar** di setiap foto.

- **Suka** cukup satu ketukan pada tanda hati. Tidak perlu isi apa pun.
- **Komentar** cukup isi nama — tidak ada pendaftaran, login, atau email. Langsung tampil.

Kodenya sudah lengkap dan ikut ter-deploy. Yang tersisa cuma satu langkah:
**memasang databasenya.** Selama database belum ada, situs tampil **persis seperti
sebelumnya** — tidak ada tombol, tidak ada yang rusak. Jadi tidak ada yang perlu
ditakutkan kalau langkah ini ditunda.

---

## Satu-satunya langkah yang perlu dikerjakan

1. Buka **Vercel → project `jurnal-eropa` → tab Storage**
2. Klik **Create Database → Neon (Serverless Postgres)** → pilih paket gratis
3. Di layar **Connect a Project**: pilih project `jurnal-eropa`, centang **Production** dan
   **Preview**, dan **biarkan kolom Custom Prefix kosong**. Lalu **Connect**
4. Buka tab **Deployments**, klik deployment paling atas → **Redeploy**

Selesai. Tabel `comments` dan `likes` dibuat sendiri saat permintaan pertama masuk —
tidak perlu menjalankan SQL apa pun.

Vercel otomatis menyuntikkan `DATABASE_URL` ke project. Nama variabel lain juga diterima:
`POSTGRES_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING`. Dan kalau semuanya
tidak ada, kode akan memakai variabel apa pun yang isinya berbentuk connection string
Postgres (`postgres://...`) — jadi custom prefix apa pun tetap jalan.

**Kalau komentar tidak muncul**, buka tab **Functions** di Vercel dan lihat lognya.
Saat connection string tidak ditemukan, log mencatat daftar nama variabel yang tersedia
(hanya namanya, tidak pernah isinya) supaya ketahuan nama mana yang sebenarnya dipakai.

### Opsional

Set variabel `COMMENTS_SALT` ke teks acak apa pun (Settings → Environment Variables).
Ini garam untuk hashing IP. Ada nilai bawaan, jadi tidak wajib.

---

## Cara memoderasi

Komentar tersimpan di satu tabel Postgres biasa. Buka **Neon Console → SQL Editor**
(tautannya ada di tab Storage), lalu:

```sql
-- lihat yang terbaru
select id, page, photo_id, name, body, created_at
from comments order by created_at desc limit 50;

-- hapus satu komentar
delete from comments where id = 123;

-- hapus semua komentar dari satu nama
delete from comments where name = 'Spammer';

-- bersihkan satu foto
delete from comments where photo_id = 'h8-bebek.jpg';
```

### Suka

```sql
-- foto paling disukai
select photo_id, count(*)::int as suka
from likes group by photo_id order by suka desc limit 20;

-- jumlah suka per halaman
select page, count(*)::int as suka from likes group by page order by page;

-- hapus suka untuk satu foto
delete from likes where photo_id = 'h8-bebek.jpg';
```

---

## Yang sudah dipasang sebagai pengaman

| Pengaman | Keterangan |
|---|---|
| Anti-XSS | Isi komentar dirender lewat `textContent`, tidak pernah `innerHTML`. HTML atau `<script>` yang diketik pengunjung tampil sebagai teks biasa. |
| Anti-injeksi SQL | Semua nilai lewat parameter query. Nama foto dan halaman juga disaring pola sebelum menyentuh database. |
| Rate limit | Maksimal 5 komentar per IP per 10 menit, balasannya HTTP 429. |
| Honeypot | Ada kolom isian tersembunyi; kalau terisi, kiriman dibuang diam-diam. |
| Batas panjang | Nama 40 karakter, komentar 1000 karakter. Karakter kontrol dibuang. |
| Privasi | IP tidak pernah disimpan mentah — hanya hash SHA-256 bergaram, dan itu cuma dipakai untuk rate limit. |
| Suka tidak terhitung ganda | Kunci ganda `(photo_id, visitor_id)` di database, bukan pengecekan terpisah — jadi dua ketukan cepat tetap terhitung satu. |
| Rate limit suka | 120 tindakan per IP per 10 menit. Sengaja longgar: satu halaman berisi puluhan foto. |

**Batas kejujuran fitur suka:** penanda pengunjung disimpan di `localStorage` browsernya.
Orang yang menghapusnya bisa menyukai foto yang sama lagi. Untuk jurnal perjalanan ini
itu cukup — mencegah hitungan ganda karena tidak sengaja, bukan mencegah orang yang
memang berniat menaikkan angka.

---

## Susunan berkas

| Berkas | Isi |
|---|---|
| `api/comments.js` | Serverless function Vercel. `GET ?page=` mengembalikan jumlah komentar **dan suka** per foto dalam satu permintaan; `GET ?photo=` mengembalikan isi percakapan; `POST` menyimpan komentar baru. |
| `api/likes.js` | `POST` untuk menyukai dan membatalkannya; `GET ?photo=` untuk jumlah suka satu foto. Memakai ulang helper dari `comments.js` supaya aturan penyaringan dan hashing IP tidak bercabang jadi dua versi. |
| `comments.js` | Skrip sisi pengunjung. Memasang tombol suka dan lencana komentar di sudut tiap foto, plus panel komentarnya. Kalau API gagal, skrip ini diam dan halaman tampil apa adanya. |
| `styles.css` | Bagian `--- komentar per foto ---` di paling bawah. |
| `hari-*.html` | Satu baris `<script src="comments.js" defer>` sebelum `</body>`. |

Identitas foto memakai **nama berkasnya** (`h8-bebek.jpg`), jadi selama nama berkas
tidak diubah, komentar tetap menempel pada fotonya.

---

## Menjalankan tesnya

```bash
npm run test:setup   # pasang PGlite + Playwright (tidak ikut ke package.json)
npm test
```

`test/api.test.mjs` menjalankan SQL sungguhan di Postgres sungguhan (PGlite).
`test/browser.test.mjs` menjalankan situs sungguhan di Chromium sungguhan: mengirim
komentar, memuat ulang halaman, mencoba menyuntikkan `<script>`, dan memastikan
halaman kembali normal saat API dimatikan.
