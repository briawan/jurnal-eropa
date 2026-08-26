import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';

// Integrasi Neon di Vercel biasanya menyuntikkan DATABASE_URL, tapi namanya bisa berubah
// kalau prefix khusus dipakai saat memasang. Nama yang lazim dicoba lebih dulu; kalau tidak
// ada satu pun, apa pun yang berbentuk connection string Postgres dipakai — supaya
// pemasangan tidak gagal hanya gara-gara nama variabel.
const NAMA_LAZIM = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
];
const POSTGRES_URL_RE = /^postgres(?:ql)?:\/\/\S+$/i;

export function cariConnectionString(env) {
  for (const nama of NAMA_LAZIM) {
    const nilai = env[nama];
    if (typeof nilai === 'string' && POSTGRES_URL_RE.test(nilai.trim())) return nilai.trim();
  }
  // Cadangan: pindai seluruh env. Yang tanpa "unpooled"/"non_pooling" didahulukan,
  // karena serverless function lebih cocok memakai koneksi ter-pool.
  const kandidat = Object.entries(env)
    .filter(([, v]) => typeof v === 'string' && POSTGRES_URL_RE.test(v.trim()))
    .map(([k, v]) => [k, v.trim()])
    .sort(([a], [b]) => {
      const skor = (n) => (/UNPOOLED|NON_POOLING/i.test(n) ? 1 : 0);
      return skor(a) - skor(b) || a.localeCompare(b);
    });
  return kandidat.length ? kandidat[0][1] : '';
}

const CONN = cariConnectionString(process.env);

const PHOTO_RE = /^[a-z0-9][a-z0-9._-]{0,80}\.(?:jpg|jpeg|png|webp)$/i;
const PAGE_RE = /^[a-z0-9][a-z0-9-]{0,40}\.html$/i;

const MAX_NAME = 40;
const MAX_BODY = 1000;
const RATE_MAX = 5; // komentar per IP per sepuluh menit
const THREAD_LIMIT = 200;

let schemaReady = null;

export async function ensureSchema(sql) {
  await sql`create table if not exists comments (
    id         bigserial primary key,
    photo_id   text not null,
    page       text not null,
    name       text not null,
    body       text not null,
    ip_hash    text,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists comments_photo_idx on comments (photo_id, created_at)`;
  await sql`create index if not exists comments_page_idx on comments (page)`;
  await sql`create index if not exists comments_rate_idx on comments (ip_hash, created_at)`;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length) return String(fwd[0]).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

// IP tidak pernah disimpan mentah — hanya sidik jarinya, dan itu cuma dipakai untuk rate limit.
function hashIp(req) {
  const salt = process.env.COMMENTS_SALT || 'jurnal-eropa-2026';
  return createHash('sha256').update(`${clientIp(req)}|${salt}`).digest('hex').slice(0, 32);
}

function readBody(req) {
  const raw = req.body;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Buang karakter kontrol, samakan akhir baris, rapatkan baris kosong beruntun.
function clean(value, max) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!CONN) {
    // Cuma nama variabelnya yang dicatat, tidak pernah nilainya — supaya penyebabnya
    // kelihatan di log Vercel (tab Functions) tanpa membocorkan kredensial.
    console.error(
      'Tidak ada connection string Postgres. Variabel yang tersedia:',
      Object.keys(process.env).filter((k) => /URL|POSTGRES|DATABASE|NEON|PG/i.test(k)).join(', ') || '(tidak ada)'
    );
    return res.status(503).json({ error: 'Database komentar belum dikonfigurasi.' });
  }

  const sql = neon(CONN);
  try {
    schemaReady ??= ensureSchema(sql);
    await schemaReady;
  } catch (err) {
    schemaReady = null; // supaya permintaan berikutnya mencoba lagi
    console.error('schema error', err);
    return res.status(503).json({ error: 'Database komentar belum siap.' });
  }

  try {
    if (req.method === 'GET') return await handleGet(req, res, sql);
    if (req.method === 'POST') return await handlePost(req, res, sql);
  } catch (err) {
    console.error('comments error', err);
    return res.status(500).json({ error: 'Terjadi kesalahan di server.' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method tidak didukung.' });
}

export async function handleGet(req, res, sql) {
  const photo = String(req.query.photo || '');
  const page = String(req.query.page || '');

  // Satu foto: seluruh isi percakapannya.
  if (photo) {
    if (!PHOTO_RE.test(photo)) return res.status(400).json({ error: 'Nama foto tidak valid.' });
    const comments = await sql`
      select id, name, body, created_at
      from comments
      where photo_id = ${photo}
      order by created_at asc, id asc
      limit ${THREAD_LIMIT}`;
    return res.status(200).json({ photo, comments });
  }

  // Satu halaman: cuma jumlahnya, untuk lencana di tiap foto.
  if (page) {
    if (!PAGE_RE.test(page)) return res.status(400).json({ error: 'Nama halaman tidak valid.' });
    const rows = await sql`
      select photo_id, count(*)::int as total
      from comments
      where page = ${page}
      group by photo_id`;
    const counts = {};
    for (const row of rows) counts[row.photo_id] = row.total;
    return res.status(200).json({ page, counts });
  }

  return res.status(400).json({ error: 'Sebutkan photo atau page.' });
}

export async function handlePost(req, res, sql) {
  const data = readBody(req);

  // Kolom umpan: disembunyikan dari manusia, sering diisi bot. Jawab seolah sukses.
  if (clean(data.website, 50)) return res.status(201).json({ comment: null });

  const photo = String(data.photo || '');
  const page = String(data.page || '');
  const name = clean(data.name, MAX_NAME);
  const body = clean(data.body, MAX_BODY);

  if (!PHOTO_RE.test(photo)) return res.status(400).json({ error: 'Foto tidak dikenali.' });
  if (!PAGE_RE.test(page)) return res.status(400).json({ error: 'Halaman tidak dikenali.' });
  if (!name) return res.status(400).json({ error: 'Nama wajib diisi.' });
  if (!body) return res.status(400).json({ error: 'Komentarnya masih kosong.' });

  const ipHash = hashIp(req);
  const [{ recent }] = await sql`
    select count(*)::int as recent
    from comments
    where ip_hash = ${ipHash} and created_at > now() - interval '10 minutes'`;
  if (recent >= RATE_MAX) {
    res.setHeader('Retry-After', '600');
    return res
      .status(429)
      .json({ error: `Sudah ${RATE_MAX} komentar dalam sepuluh menit terakhir. Coba lagi sebentar lagi.` });
  }

  const [comment] = await sql`
    insert into comments (photo_id, page, name, body, ip_hash)
    values (${photo}, ${page}, ${name}, ${body}, ${ipHash})
    returning id, name, body, created_at`;

  return res.status(201).json({ comment });
}
