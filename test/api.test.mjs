// Jalankan: npm run test:setup lalu npm test
// Menguji SQL sungguhan di Postgres sungguhan (PGlite, Postgres versi WASM).
import { PGlite } from '@electric-sql/pglite';
import { ensureSchema, handleGet, handlePost, cariConnectionString } from '../api/comments.js';
import { handleGet as likeGet, handlePost as likePost } from '../api/likes.js';

const db = new PGlite();
const sql = async (strings, ...values) => {
  let text = '';
  strings.forEach((s, i) => { text += s; if (i < values.length) text += '$' + (i + 1); });
  const r = await db.query(text, values);
  return r.rows;
};

function mkRes() {
  const out = { code: 0, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(c) { out.code = c; return this; },
    json(o) { out.body = o; return this; },
  };
}
const req = (extra) => ({ headers: { 'x-forwarded-for': '203.0.113.7' }, ...extra });

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  ok  ', label); }
  else { fail++; console.log('  FAIL', label, detail !== undefined ? JSON.stringify(detail) : ''); }
}

await ensureSchema(sql);
console.log('skema dibuat (SQL sungguhan dijalankan Postgres)\n');

// --- POST: jalur normal ---
let r = mkRes();
await handlePost(req({ body: { photo: 'h8-sarapan-hotel.jpg', page: 'hari-08.html', name: 'Budi', body: 'Kelihatan enak!' } }), r, sql);
check('komentar valid -> 201', r.out.code === 201, r.out);
check('komentar dikembalikan', r.out.body?.comment?.name === 'Budi', r.out.body);

// --- POST: validasi ---
const bad = [
  ['nama kosong', { photo: 'h8-sarapan-hotel.jpg', page: 'hari-08.html', name: '   ', body: 'halo' }],
  ['isi kosong', { photo: 'h8-sarapan-hotel.jpg', page: 'hari-08.html', name: 'Budi', body: '' }],
  ['foto ngawur', { photo: '../../etc/passwd', page: 'hari-08.html', name: 'Budi', body: 'halo' }],
  ['halaman ngawur', { photo: 'h8-sarapan-hotel.jpg', page: 'evil.php', name: 'Budi', body: 'halo' }],
];
for (const [label, body] of bad) {
  const rr = mkRes();
  await handlePost(req({ body }), rr, sql);
  check(label + ' -> 400', rr.out.code === 400, rr.out);
}

// --- honeypot ---
r = mkRes();
await handlePost(req({ body: { photo: 'h8-sarapan-hotel.jpg', page: 'hari-08.html', name: 'Bot', body: 'spam', website: 'http://spam' } }), r, sql);
check('honeypot tidak menyimpan apa-apa', r.out.body?.comment === null, r.out.body);

// --- pemotongan panjang + karakter kontrol ---
r = mkRes();
await handlePost(req({ body: { photo: 'h8-bebek.jpg', page: 'hari-08.html', name: 'X'.repeat(120), body: 'a\u0000b\u0007c' } }), r, sql);
check('nama dipotong ke 40', r.out.body?.comment?.name.length === 40, r.out.body?.comment?.name.length);
check('karakter kontrol dibuang', r.out.body?.comment?.body === 'abc', r.out.body?.comment?.body);

// --- HTML disimpan mentah (di-escape saat dirender di browser) ---
r = mkRes();
const xss = '<img src=x onerror=alert(1)>';
await handlePost(req({ body: { photo: 'h8-bebek.jpg', page: 'hari-08.html', name: 'Eve', body: xss } }), r, sql);
check('HTML tersimpan apa adanya, tidak dieksekusi di server', r.out.body?.comment?.body === xss, r.out.body?.comment?.body);

// --- rate limit ---
let limited = false;
for (let i = 0; i < 8; i++) {
  const rr = mkRes();
  await handlePost(req({ body: { photo: 'h8-bebek.jpg', page: 'hari-08.html', name: 'Spammer', body: 'ke-' + i } }), rr, sql);
  if (rr.out.code === 429) { limited = true; check('rate limit aktif di percobaan ke-' + (i + 1), rr.out.headers['Retry-After'] === '600', rr.out.headers); break; }
}
check('rate limit memblokir sebelum 8 kiriman', limited);

// --- IP berbeda tidak ikut kena ---
r = mkRes();
await handlePost({ headers: { 'x-forwarded-for': '198.51.100.4' }, body: { photo: 'h8-bebek.jpg', page: 'hari-08.html', name: 'Orang lain', body: 'aman' } }, r, sql);
check('IP lain tidak ikut diblokir -> 201', r.out.code === 201, r.out);

// --- IP mentah tidak pernah tersimpan ---
const stored = await sql`select distinct ip_hash from comments`;
check('IP disimpan sebagai hash, bukan alamat asli',
  stored.every((row) => row.ip_hash && !row.ip_hash.includes('203.0.113') && row.ip_hash.length === 32), stored);

// --- GET satu foto ---
r = mkRes();
await handleGet(req({ query: { photo: 'h8-sarapan-hotel.jpg' } }), r, sql);
check('GET foto -> 200', r.out.code === 200, r.out.code);
check('hanya komentar foto itu yang keluar', r.out.body.comments.length === 1 && r.out.body.comments[0].name === 'Budi', r.out.body.comments);

// --- GET jumlah per halaman ---
r = mkRes();
await handleGet(req({ query: { page: 'hari-08.html' } }), r, sql);
const counts = r.out.body.counts;
check('GET halaman mengembalikan jumlah', counts['h8-sarapan-hotel.jpg'] === 1 && counts['h8-bebek.jpg'] >= 2, counts);

// --- GET tanpa parameter ---
r = mkRes();
await handleGet(req({ query: {} }), r, sql);
check('GET tanpa parameter -> 400', r.out.code === 400, r.out.code);

// --- SQL injection lewat nama foto ditolak sebelum menyentuh query ---
r = mkRes();
await handleGet(req({ query: { photo: "x.jpg'; drop table comments; --" } }), r, sql);
check('foto berisi SQL ditolak -> 400', r.out.code === 400, r.out);
const alive = await sql`select count(*)::int as n from comments`;
check('tabel masih ada setelah percobaan injeksi', alive[0].n > 0, alive);

// ============ SUKA ============
const V1 = 'pengunjungsatu01';
const V2 = 'pengunjungdua002';
const foto = 'h8-panorama-danau.jpg';
const likeReq = (body, ip) => ({ headers: { 'x-forwarded-for': ip || '203.0.113.9' }, body });

// menyukai
r = mkRes();
await likePost(likeReq({ photo: foto, page: 'hari-08.html', visitor: V1, liked: true }), r, sql);
check('suka pertama -> total 1', r.out.code === 200 && r.out.body.total === 1 && r.out.body.liked === true, r.out.body);

// menyukai lagi dari pengunjung yang sama tidak menambah
r = mkRes();
await likePost(likeReq({ photo: foto, page: 'hari-08.html', visitor: V1, liked: true }), r, sql);
check('suka ganda dari orang yang sama tetap 1', r.out.body.total === 1, r.out.body);

// orang kedua menambah
r = mkRes();
await likePost(likeReq({ photo: foto, page: 'hari-08.html', visitor: V2, liked: true }, '198.51.100.9'), r, sql);
check('pengunjung kedua -> total 2', r.out.body.total === 2, r.out.body);

// membatalkan suka
r = mkRes();
await likePost(likeReq({ photo: foto, page: 'hari-08.html', visitor: V1, liked: false }), r, sql);
check('batal suka -> total 1', r.out.body.total === 1 && r.out.body.liked === false, r.out.body);

// membatalkan yang belum pernah disukai tidak membuat angka minus
r = mkRes();
await likePost(likeReq({ photo: foto, page: 'hari-08.html', visitor: 'belumpernahsuka1', liked: false }), r, sql);
check('batal suka yang tidak ada tidak bikin minus', r.out.body.total === 1, r.out.body);

// validasi
for (const [label, body] of [
  ['foto ngawur', { photo: '../rahasia', page: 'hari-08.html', visitor: V1, liked: true }],
  ['halaman ngawur', { photo: foto, page: 'jahat.php', visitor: V1, liked: true }],
  ['penanda pengunjung kosong', { photo: foto, page: 'hari-08.html', visitor: '', liked: true }],
  ['penanda pengunjung ngawur', { photo: foto, page: 'hari-08.html', visitor: "x'; drop table likes; --", liked: true }],
]) {
  const rr = mkRes();
  await likePost(likeReq(body), rr, sql);
  check('suka: ' + label + ' -> 400', rr.out.code === 400, rr.out);
}
const likesAlive = await sql`select count(*)::int as n from likes`;
check('tabel likes selamat dari percobaan injeksi', likesAlive[0].n === 1, likesAlive);

// GET satu foto: jumlah + apakah pengunjung ini sudah menyukainya
r = mkRes();
await likeGet({ headers: {}, query: { photo: foto, visitor: V2 } }, r, sql);
check('GET suka: V2 tercatat sudah menyukai', r.out.body.total === 1 && r.out.body.liked === true, r.out.body);
r = mkRes();
await likeGet({ headers: {}, query: { photo: foto, visitor: V1 } }, r, sql);
check('GET suka: V1 sudah membatalkan', r.out.body.liked === false, r.out.body);
r = mkRes();
await likeGet({ headers: {}, query: { photo: foto } }, r, sql);
check('GET suka tanpa penanda tetap memberi jumlah', r.out.body.total === 1 && r.out.body.liked === false, r.out.body);

// rate limit suka
let likeLimited = false;
for (let i = 0; i < 130; i++) {
  const rr = mkRes();
  await likePost(likeReq({ photo: 'h8-bebek.jpg', page: 'hari-08.html', visitor: 'banjir' + String(i).padStart(10, '0'), liked: true }, '192.0.2.55'), rr, sql);
  if (rr.out.code === 429) { likeLimited = true; break; }
}
check('rate limit suka menahan banjir dari satu IP', likeLimited);

// jumlah suka ikut di GET halaman
r = mkRes();
await handleGet(req({ query: { page: 'hari-08.html' } }), r, sql);
check('GET halaman membawa jumlah suka sekalian', r.out.body.likes && r.out.body.likes[foto] === 1, r.out.body.likes);
check('GET halaman tetap membawa jumlah komentar', r.out.body.counts['h8-sarapan-hotel.jpg'] === 1, r.out.body.counts);

// --- pencarian connection string, apa pun nama variabelnya ---
const PG = 'postgresql://u:p@host/db';
check('memakai DATABASE_URL kalau ada',
  cariConnectionString({ DATABASE_URL: PG, STORAGE_URL: 'postgres://lain/x' }) === PG);
check('memakai POSTGRES_URL kalau DATABASE_URL tidak ada',
  cariConnectionString({ POSTGRES_URL: PG }) === PG);
check('menemukan nama tak lazim hasil custom prefix',
  cariConnectionString({ STORAGE_URL: PG }) === PG);
check('mendahulukan koneksi ter-pool daripada unpooled',
  cariConnectionString({ MYDB_URL_UNPOOLED: 'postgres://unpooled/x', MYDB_URL: PG }) === PG);
check('mengabaikan nilai yang bukan connection string Postgres',
  cariConnectionString({ SOME_URL: 'https://contoh.com', TOKEN: 'abc' }) === '');
check('mengembalikan kosong kalau tidak ada apa-apa', cariConnectionString({}) === '');

console.log(`\n${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
