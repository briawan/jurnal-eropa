import { neon } from '@neondatabase/serverless';
// Berbagi helper dengan endpoint komentar supaya aturan penyaringan, pencarian
// connection string, dan cara hashing IP tidak pernah bercabang jadi dua versi.
import { cariConnectionString, ensureSchema, hashIp, PHOTO_RE, PAGE_RE } from './comments.js';

const CONN = cariConnectionString(process.env);

// Longgar dengan sengaja: satu halaman memuat puluhan foto, dan orang yang sedang
// asyik menggulir wajar saja menyukai banyak sekaligus. Ini pagar anti-skrip,
// bukan pagar untuk pembaca.
const RATE_MAX = 120; // tindakan suka per IP per sepuluh menit
const VISITOR_RE = /^[a-z0-9]{8,64}$/i;

let schemaReady = null;

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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!CONN) return res.status(503).json({ error: 'Database belum dikonfigurasi.' });

  const sql = neon(CONN);
  try {
    schemaReady ??= ensureSchema(sql);
    await schemaReady;
  } catch (err) {
    schemaReady = null;
    console.error('schema error', err);
    return res.status(503).json({ error: 'Database belum siap.' });
  }

  try {
    if (req.method === 'GET') return await handleGet(req, res, sql);
    if (req.method === 'POST') return await handlePost(req, res, sql);
  } catch (err) {
    console.error('likes error', err);
    return res.status(500).json({ error: 'Terjadi kesalahan di server.' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method tidak didukung.' });
}

// Dipakai saat panel sebuah foto dibuka: jumlahnya, plus apakah pengunjung ini
// termasuk yang sudah menyukainya.
export async function handleGet(req, res, sql) {
  const photo = String(req.query.photo || '');
  const visitor = String(req.query.visitor || '');
  if (!PHOTO_RE.test(photo)) return res.status(400).json({ error: 'Nama foto tidak valid.' });

  const [totals, mine] = await Promise.all([
    sql`select count(*)::int as total from likes where photo_id = ${photo}`,
    VISITOR_RE.test(visitor)
      ? sql`select 1 from likes where photo_id = ${photo} and visitor_id = ${visitor} limit 1`
      : Promise.resolve([]),
  ]);

  return res.status(200).json({ photo, total: totals[0].total, liked: mine.length > 0 });
}

export async function handlePost(req, res, sql) {
  const data = readBody(req);
  const photo = String(data.photo || '');
  const page = String(data.page || '');
  const visitor = String(data.visitor || '');
  const liked = data.liked !== false; // tanpa keterangan, anggap menyukai

  if (!PHOTO_RE.test(photo)) return res.status(400).json({ error: 'Foto tidak dikenali.' });
  if (!PAGE_RE.test(page)) return res.status(400).json({ error: 'Halaman tidak dikenali.' });
  if (!VISITOR_RE.test(visitor)) return res.status(400).json({ error: 'Penanda pengunjung tidak valid.' });

  const ipHash = hashIp(req);

  if (liked) {
    const [{ recent }] = await sql`
      select count(*)::int as recent
      from likes
      where ip_hash = ${ipHash} and created_at > now() - interval '10 minutes'`;
    if (recent >= RATE_MAX) {
      res.setHeader('Retry-After', '600');
      return res.status(429).json({ error: 'Terlalu banyak dalam waktu singkat. Coba lagi sebentar lagi.' });
    }
    // Kunci ganda (photo_id, visitor_id) yang menahan hitungan ganda, bukan pengecekan
    // terpisah — jadi dua ketukan cepat tetap terhitung satu.
    await sql`
      insert into likes (photo_id, page, visitor_id, ip_hash)
      values (${photo}, ${page}, ${visitor}, ${ipHash})
      on conflict (photo_id, visitor_id) do nothing`;
  } else {
    await sql`delete from likes where photo_id = ${photo} and visitor_id = ${visitor}`;
  }

  const [{ total }] = await sql`select count(*)::int as total from likes where photo_id = ${photo}`;
  return res.status(200).json({ photo, total, liked });
}
