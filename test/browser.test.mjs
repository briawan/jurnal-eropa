// Jalankan: npm run test:setup lalu npm test
// Menjalankan situs sungguhan + API sungguhan (di atas Postgres WASM) di Chromium sungguhan.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { ensureSchema, handleGet, handlePost } from '../api/comments.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();
const sql = async (strings, ...values) => {
  let text = '';
  strings.forEach((s, i) => { text += s; if (i < values.length) text += '$' + (i + 1); });
  return (await db.query(text, values)).rows;
};
await ensureSchema(sql);

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/comments') {
    // Meniru runtime Node Vercel: query sudah terurai, body JSON sudah di-parse.
    req.query = Object.fromEntries(url.searchParams);
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try { req.body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { req.body = {}; }
    }
    let code = 200, payload = null;
    const shim = { setHeader: (k, v) => res.setHeader(k, v), status(c) { code = c; return this; }, json(o) { payload = o; return this; } };
    try {
      if (req.method === 'GET') await handleGet(req, shim, sql);
      else if (req.method === 'POST') await handlePost(req, shim, sql);
      else { code = 405; payload = { error: 'nope' }; }
    } catch (e) { code = 500; payload = { error: String(e) }; }
    res.writeHead(code, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(payload));
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname));
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404).end('nope'); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  ', label); }
  else { fail++; console.log('  FAIL', label, detail !== undefined ? JSON.stringify(detail) : ''); }
};

// PW_CHROMIUM menunjuk ke Chromium yang sudah terpasang; tanpa itu Playwright pakai bawaannya.
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 700, height: 900 } });
const pageObj = await ctx.newPage();
const jsErrors = [];   // pengecualian JavaScript sungguhan
const logErrors = [];  // console.error, di luar kegagalan memuat berkas
pageObj.on('pageerror', (e) => jsErrors.push(String(e)));
pageObj.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Failed to load resource/i.test(t)) return; // font Google & abort yang memang disengaja
  logErrors.push(t);
});

await pageObj.goto(`${base}/hari-08.html`, { waitUntil: 'domcontentloaded' });
await pageObj.waitForSelector('.cmt-badge', { timeout: 10000 });

const badges = await pageObj.locator('.cmt-badge').count();
const imgs = await pageObj.locator('figure img[src^="images/"]').count();
check('satu lencana per foto', badges > 0 && badges === imgs, { badges, imgs });

// Tata letak grid dua kolom harus tetap sejajar setelah gambar dibungkus.
const duoHeights = await pageObj.evaluate(() => {
  const duo = document.querySelector('.duo');
  return [...duo.querySelectorAll('img')].map((i) => Math.round(i.getBoundingClientRect().height));
});
check('foto di grid .duo tetap sama tinggi', duoHeights.length === 2 && Math.abs(duoHeights[0] - duoHeights[1]) <= 1, duoHeights);

const overflow = await pageObj.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('halaman tidak melebar ke samping', overflow <= 0, overflow);

// Buka panel foto pertama.
const first = pageObj.locator('.cmt-badge').first();
await first.click();
await pageObj.waitForSelector('.cmt-panel:not([hidden]) .cmt-empty');
check('panel terbuka dengan status kosong', (await pageObj.locator('.cmt-panel:not([hidden]) .cmt-empty').innerText()).includes('Belum ada komentar'));

// Kirim komentar.
await pageObj.fill('.cmt-panel:not([hidden]) input[type=text]', 'Rina');
await pageObj.fill('.cmt-panel:not([hidden]) textarea', 'Sarapannya kelihatan tenang sekali.');
await pageObj.click('.cmt-panel:not([hidden]) .cmt-send');
await pageObj.waitForSelector('.cmt-panel:not([hidden]) .cmt-item');
check('komentar muncul di daftar', (await pageObj.locator('.cmt-item .cmt-body').first().innerText()) === 'Sarapannya kelihatan tenang sekali.');
check('nama tampil', (await pageObj.locator('.cmt-item .cmt-meta b').first().innerText()) === 'Rina');
check('lencana jadi 1', (await first.locator('.cmt-count').innerText()) === '1');
check('kotak komentar dikosongkan lagi', (await pageObj.inputValue('.cmt-panel:not([hidden]) textarea')) === '');

// Nama wajib diisi.
await pageObj.fill('.cmt-panel:not([hidden]) input[type=text]', '   ');
await pageObj.fill('.cmt-panel:not([hidden]) textarea', 'tanpa nama');
await pageObj.click('.cmt-panel:not([hidden]) .cmt-send');
check('nama kosong ditolak di sisi pengunjung', (await pageObj.locator('.cmt-panel:not([hidden]) .cmt-note').innerText()).includes('Nama wajib diisi'));

// Skrip yang diketik pengunjung harus tampil sebagai teks, bukan dijalankan.
const xss = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1<\/script>';
await pageObj.fill('.cmt-panel:not([hidden]) input[type=text]', 'Eve');
await pageObj.fill('.cmt-panel:not([hidden]) textarea', xss);
await pageObj.click('.cmt-panel:not([hidden]) .cmt-send');
await pageObj.waitForFunction(() => document.querySelectorAll('.cmt-item').length === 2);
const lastText = await pageObj.locator('.cmt-item .cmt-body').last().innerText();
check('HTML tampil sebagai teks apa adanya', lastText === xss, lastText);
check('tidak ada <img>/<script> sungguhan yang tersuntik', await pageObj.evaluate(() => !window.__pwned && !document.querySelector('.cmt-body img, .cmt-body script')));

// Panel kedua menutup panel pertama.
await pageObj.locator('.cmt-badge').nth(3).click();
await pageObj.waitForTimeout(200);
check('cuma satu panel terbuka sekaligus', (await pageObj.locator('.cmt-panel:not([hidden])').count()) === 1);

// Muat ulang: jumlah dan isi bertahan, nama diingat.
await pageObj.reload({ waitUntil: 'domcontentloaded' });
await pageObj.waitForSelector('.cmt-badge.has-cmt');
check('lencana tersimpan setelah muat ulang', (await pageObj.locator('.cmt-badge').first().locator('.cmt-count').innerText()) === '2');
await pageObj.locator('.cmt-badge').first().click();
await pageObj.waitForSelector('.cmt-panel:not([hidden]) .cmt-item');
check('komentar lama termuat kembali', (await pageObj.locator('.cmt-item').count()) === 2);
check('nama pengunjung diingat', (await pageObj.inputValue('.cmt-panel:not([hidden]) input[type=text]')) === 'Eve');

// Rekam tampilannya untuk diperiksa mata.
const panel = pageObj.locator('.cmt-panel:not([hidden])');
await panel.scrollIntoViewIfNeeded();
await pageObj.waitForTimeout(250);
await panel.screenshot({ path: path.join(ROOT, 'test', 'shot-panel.png') });
const figWithBadge = pageObj.locator('figure').first();
await figWithBadge.scrollIntoViewIfNeeded();
await pageObj.waitForTimeout(250);
await figWithBadge.screenshot({ path: path.join(ROOT, 'test', 'shot-lencana.png') });

// Kalau API mati, halaman harus kembali persis seperti semula.
await ctx.route('**/api/comments*', (r) => r.abort());
const p2 = await ctx.newPage();
await p2.goto(`${base}/hari-07.html`, { waitUntil: 'domcontentloaded' });
await p2.waitForTimeout(700);
check('API mati -> tidak ada UI komentar sama sekali', (await p2.locator('.cmt-badge, .cmt-panel').count()) === 0);
check('API mati -> gambar tetap tampil', (await p2.locator('figure img').first().boundingBox()).height > 50);

check('tidak ada pengecualian JavaScript', jsErrors.length === 0, jsErrors.slice(0, 3));
check('tidak ada console.error dari kode sendiri', logErrors.length === 0, logErrors.slice(0, 3));

await browser.close();
server.close();
console.log(`\n${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
