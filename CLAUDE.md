# Jurnal Eropa 2026 — panduan proyek

Situs statis berbahasa Indonesia: jurnal harian perjalanan 16 hari (18 Agustus – 2 September 2026) dari Jakarta ke München, Praha, Český Krumlov, Wina, Hallstatt, Salzburg, London, dan Edinburgh. Di-deploy ke Vercel lewat integrasi Git: setiap push ke `main` otomatis ter-deploy. Tidak ada build step.

## Berkas

- `index.html` — beranda: hero, hitungan (`16 dari 16 hari · N foto · 10 video`), 16 kartu hari, endnote.
- `hari-01.html` … `hari-16.html` — satu halaman per hari.
- `404.html` — halaman tidak ketemu, dalam gaya yang sama.
- `styles.css` — satu-satunya stylesheet. Font: Oswald (judul), Newsreader (isi), ui-monospace (keterangan kecil).
- `comments.js` — widget suka & komentar per foto (dimuat di tiap `hari-*.html`, bukan di index).
- `api/comments.js`, `api/likes.js` — Vercel serverless functions, Neon Postgres. Skema dibuat otomatis saat permintaan pertama.
- `images/` — semua foto, JPEG, sisi panjang 1400 px, `hNN-nama-pendek.jpg`.
- `test/` — `npm run test:setup && npm test` (pglite + Playwright).
- `KOMENTAR.md` — cara menyalakan database komentar di Vercel.

## Aturan yang tidak boleh dilanggar

1. **Nama berkas gambar adalah identitas foto.** Komentar dan suka dikunci ke nama berkas (`h16-chiko-kimmie.jpg`). Jangan pernah mengganti nama atau memindahkan berkas gambar yang sudah terbit — itu memutus utas komentar dan mengubah URL. Salah nama? Perbaiki teksnya, biarkan berkasnya.
2. **Jam diambil dari EXIF, angka dibaca dari foto.** Setiap "Jam HH.MM" di jurnal berasal dari `DateTimeOriginal` kamera. Harga, nama, tahun, dan kutipan papan dibaca dari crop resolusi penuh — bukan dari ingatan. Kalau tidak terbaca, jangan diklaim; tulis terang-terangan bahwa tidak terbaca.
3. **Jangan berspekulasi tentang dunia.** Fakta umum boleh dipakai kalau yakin dan relevan; kalau ragu, beri pagar ("konon", "menurut papannya") atau lewati. Kegagalan verifikasi ditulis apa adanya (lihat jam Balmoral di Hari 16).
4. **Privasi.** Buramkan pelat nomor kendaraan pribadi, nama petugas di struk, dan tulisan kasar di papan. Sebutkan pemburaman itu di halaman dan di PR. Orang lewat di ruang publik tidak diburamkan.
5. **Jangan hapus atau kurangi isi yang sudah terbit** kecuali diminta. Koreksi fakta dilakukan dengan menulis ulang kalimatnya, bukan menghapus bagian.

## Pipeline foto

```python
im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
# sisi panjang -> 1400 px, LANCZOS
im.save(p, quality=85, optimize=True, progressive=True)
if os.path.getsize(p) > 500*1024: im.save(p, quality=79, optimize=True, progressive=True)
```

- Cek duplikat sebelum menerbitkan: signature 16×16 grayscale, selisih rata-rata /256, `< 6` = duplikat.
- Setiap `<img>` wajib: `loading="lazy" decoding="async" src="images/…" width="W" height="H" alt="…"` — `alt` deskriptif dalam bahasa Indonesia, ≥ 25 karakter, tanpa mengulang keterangan.

## Sistem desain (kelas yang ada — jangan menciptakan yang baru tanpa menambah CSS)

- Halaman: `.topbar` → `.wrap` → `header.hero` (`.eyebrow` "Jurnal Eropa · Hari N dari 16", `h1`, `.dek`) → `section.stub[aria-label="Ringkasan Hari N"]` → `p.lead` → bagian-bagian `h2` + `p.h2-sub` → `.tips` → `footer` → `.pager` → `comments.js`.
- `.stub` / `.stub-row` / `.stub-code` / `.stub-main` / `.stub-route` / `.stub-meta` / `.tag.ok` / `.tag.late`. **`.stub-code` lebarnya 62 px**: pakai kode pendek (jam `11.06`, harga `£6,00`, tahun `1816`, satu kata ≤ 6 huruf). Kata panjang meluber — render check akan menangkapnya.
- `figure` + `figcaption`; `figure.portrait` (maks 360 px) untuk tangkapan layar tegak; `.duo` (dua `figure style="margin:0"`) + `p.duo-cap`.
- `.pull` (kutipan besar; `.pull-sub` untuk baris kecil di dalamnya), `.tips` (`h3` + `ol` + `li`; `.note` untuk catatan kecil), `.sr-only`.
- Tidak ada aturan untuk `<ul>` telanjang — pakai `.stub` atau `.tips ol`.
- Gaya bahasa: Indonesia santai-jurnalistik, sudut pandang "kami", boleh "nggak/bikin/kayak". Desimal koma (`£6,00`, `€30,80`), ribuan titik (`€50.000`). Jam `Jam 11.06`; teks papan dikutip apa adanya (`22:35`).

## Alur menerbitkan hari / menambah foto

1. Baca EXIF semua foto → susun kronologi. Cek duplikat terhadap `images/`.
2. Crop & zoom setiap papan/struk/plakat sebelum mengutip.
3. Proses foto ke `images/hNN-*.jpg`; tulis/ubah `hari-NN.html`.
4. Perbarui `index.html`: kartu hari (**ringkas, ± 30–80 kata**), hitungan foto (`grep -c '<img ' hari-*.html | … | bc`), tautan "hari terakhir".
5. Pager & footer: `hari-(N-1)` ↔ `hari-N` ↔ `hari-(N+1)`; footer `Berikutnya: Hari N+1 — <judul kartu>`.
6. Validasi: keseimbangan tag, anchor `href="#…"` dan `hari-NN.html#…` semuanya ada, semua `images/hNN-*` terpakai, `width/height` cocok dengan berkas.
7. Render Chromium (skrip `.cjs` di root repo, `executablePath:'/opt/pw-browsers/chromium'`) di **900 px dan 390 px**: 0 gambar rusak, tanpa overflow horizontal, tanpa `.stub-code` yang meluber. Hapus skrip dan `node_modules` sesudahnya.
8. Commit → push → PR **draft** → undraft → merge dengan **merge commit** berjudul `<judul PR> (#N)` → verifikasi di `origin/main`.

## Yang belum bisa dilakukan dari sesi

- **EXIF Hari 1–10 sudah hilang permanen.** Pipeline PIL di atas menyimpan ulang tanpa EXIF sejak commit pertama, jadi 0 dari 885 berkas di `images/` punya `DateTimeOriginal` — blob git paling awal pun sudah bersih. Berkas asli Hari 1–10 ikut hilang bersama kontainer sesi lama; yang tersisa cuma di ponsel pemilik. Jam di Hari 11–16 selamat karena originalnya masih ada saat halaman itu ditulis.
- **Sisiran jam dari isi foto Hari 1–7 sudah dilakukan dan hasilnya tipis** (311 foto, 102 kandidat, dua contact sheet + belasan zoom). Yang terbaca cuma teks cetak dari dekat: struk Český Krumlov `21.08.2026 14:10:49` (Hari 4) dan struk Burger King `12.21` (Hari 5). Jam analog jauh — menara Orloj, jam dinding SPBU, layar kasir Billa, kios BK, papan halte — semuanya kalah resolusi di berkas 1400 px. Jam Rolex DXB di Hari 1 terbaca kira-kira saja dan sudah diterbitkan dengan pagar. **Jangan ulangi sisiran ini**; satu-satunya jalan tersisa adalah pemilik mengirim ulang foto aslinya.

- Verifikasi deploy Vercel (konektor tidak berwenang; proxy menolak `*.vercel.app`). Verifikasi dengan membaca `origin/main`.
- `og:image`, `<link rel="canonical">`, `sitemap.xml` butuh domain produksi yang pasti — belum ada di repo.
