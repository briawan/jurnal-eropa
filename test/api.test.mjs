// Jalankan: npm run test:setup lalu npm test
// Menguji SQL sungguhan di Postgres sungguhan (PGlite, Postgres versi WASM).
import { PGlite } from '@electric-sql/pglite';
import { ensureSchema, handleGet, handlePost } from '../api/comments.js';

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

console.log(`\n${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
