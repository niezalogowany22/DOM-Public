// Vercel Function: import przepisu z adresu strony (dane schema.org/Recipe z JSON-LD).
//   GET /api/przepis?url=https://…        → dane przepisu
//   GET /api/przepis?img=https://…        → zdjęcie przepisu (do skopiowania do własnego Supabase)
// Wymaga zalogowania: nagłówek Authorization: Bearer <token sesji Supabase>.
// Zmienne środowiskowe: SUPABASE_URL oraz SUPABASE_ANON_KEY (albo SUPABASE_SERVICE_KEY).
// Ten plik MUSI leżeć w folderze api/.

const dns = require('dns').promises;
const net = require('net');
const E = process.env;
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36';
const MAX_HTML = 3_000_000, MAX_IMG = 5_000_000, MAX_REDIRECTS = 4;

// Adresy prywatne / lokalne / zarezerwowane — nigdy nie łączymy się z nimi (ochrona przed SSRF)
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return privateIp(x.slice(7));
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') ||
    x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff');
}
async function checkUrl(u) {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol)) throw new Error('Nieprawidłowy adres');
  if (url.username || url.password) throw new Error('Nieprawidłowy adres');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Nieprawidłowy adres');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map(r => r.address);
  if (!ips.length || ips.some(privateIp)) throw new Error('Nieprawidłowy adres');
  return url;
}
// Pobieranie z ręcznym śledzeniem przekierowań — każdy krok sprawdzany osobno
async function safeFetch(u, accept) {
  let url = await checkUrl(u);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'manual', headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'pl,en;q=0.8' } });
    clearTimeout(t);
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = await checkUrl(new URL(r.headers.get('location'), url).href); continue; }
    return r;
  }
  throw new Error('Za dużo przekierowań');
}
async function readLimited(r, max) {
  const len = +r.headers.get('content-length') || 0;
  if (len > max) throw new Error('Plik jest za duży');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > max) throw new Error('Plik jest za duży');
  return buf;
}
// Weryfikacja sesji Supabase — tylko zalogowani użytkownicy
async function authorized(req) {
  const auth = String(req.headers.authorization || '');
  const key = E.SUPABASE_ANON_KEY || E.SUPABASE_SERVICE_KEY;
  if (!auth.startsWith('Bearer ') || !E.SUPABASE_URL || !key) return false;
  const r = await fetch(E.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', { headers: { Authorization: auth, apikey: key } });
  return r.ok;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (!(await authorized(req))) return res.status(401).json({ ok: false, error: 'Zaloguj się ponownie' });
    if (req.query.img) {
      const r = await safeFetch(String(req.query.img), 'image/avif,image/webp,image/jpeg,image/png,image/*');
      const type = String(r.headers.get('content-type') || '').split(';')[0].trim();
      if (!r.ok || !/^image\/(jpeg|png|webp|avif|gif)$/.test(type)) throw new Error('To nie jest zdjęcie');
      const buf = await readLimited(r, MAX_IMG);
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      return res.status(200).send(buf);
    }
    const r = await safeFetch(String(req.query.url || ''), 'text/html');
    if (!r.ok) throw new Error('Strona odpowiedziała błędem ' + r.status);
    const html = (await readLimited(r, MAX_HTML)).toString('utf8');
    const recipe = findRecipe(html);
    if (!recipe) {
      const title = (html.match(/<title[^>]*>([^<]*)/i) || [])[1];
      return res.status(200).json({ ok: false, title: decode(title || '').trim(), error: 'Na tej stronie nie ma danych przepisu — wklej składniki i kroki ręcznie.' });
    }
    res.status(200).json({ ok: true, ...normalize(recipe, r.url || String(req.query.url)) });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.name === 'AbortError' ? 'Strona nie odpowiada' : e.code === 'ENOTFOUND' ? 'Nie ma takiej strony' : e.message });
  }
};

function findRecipe(html) {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b.trim()); } catch { try { data = JSON.parse(b.trim().replace(/[\u0000-\u001f]+/g, ' ')); } catch { continue; } }
    const found = walk(data);
    if (found) return found;
  }
  return null;
}
function walk(x) {
  if (!x || typeof x !== 'object') return null;
  if (Array.isArray(x)) { for (const y of x) { const f = walk(y); if (f) return f; } return null; }
  const type = [].concat(x['@type'] || []);
  if (type.includes('Recipe')) return x;
  return walk(x['@graph']) || walk(x.mainEntity) || null;
}
const decode = s => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/\s+/g, ' ').trim();
function steps(x) {
  if (!x) return [];
  if (typeof x === 'string') return x.split(/\n+|(?<=\.)\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ0-9])/).map(decode).filter(Boolean);
  if (Array.isArray(x)) return x.flatMap(steps);
  if (x.itemListElement) return steps(x.itemListElement);
  return [decode(x.text || x.name)].filter(Boolean);
}
function minutes(iso) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(iso || '');
  if (!m) return null;
  const v = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return v || null;
}
function normalize(r, source) {
  const img = [].concat(r.image || [])[0];
  const yieldStr = [].concat(r.recipeYield || [])[0];
  return {
    title: decode(r.name),
    servings: parseInt(String(yieldStr || '').match(/\d+/)?.[0]) || null,
    time_min: minutes(r.totalTime) || ((minutes(r.prepTime) || 0) + (minutes(r.cookTime) || 0)) || null,
    ingredients: [].concat(r.recipeIngredient || r.ingredients || []).map(decode).filter(Boolean),
    steps: steps(r.recipeInstructions),
    image_url: typeof img === 'string' ? img : img?.url || null,
    source_url: source,
  };
}
