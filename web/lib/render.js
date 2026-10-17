// Shared helpers for the share pages (Cloudflare Pages Functions, no dependencies).
// Data comes from Supabase with the PUBLISHABLE key only: catalog tables are public-read via RLS.

export const LANGS = ['en', 'mr', 'hi'];

export function pickLang(request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('lang');
  if (LANGS.includes(q)) return q;
  const header = request.headers.get('accept-language') || '';
  for (const part of header.split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (LANGS.includes(code)) return code;
  }
  return 'en';
}

/** {en, mr, hi} → text in `lang`, falling back to English. */
export const loc = (v, lang) => (v && (v[lang] || v.en || Object.values(v).find(Boolean))) || '';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export const rupees = (n) =>
  '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

export async function rpc(env, fn, args) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args ?? {}),
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status}`);
  return res.json();
}

export async function select(env, pathAndQuery) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: env.SUPABASE_ANON_KEY },
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`${pathAndQuery}: ${res.status}`);
  return res.json();
}

export const imageUrl = (env, path) =>
  path ? `${env.SUPABASE_URL}/storage/v1/object/public/catalog/${String(path).replace(/^\/+/, '')}` : null;

const T = {
  en: { open: 'Open in app', get: 'Get the app', call: 'Call store', wa: 'WhatsApp', out: 'Out of stock', inStock: 'In stock', mrp: 'MRP', off: 'off', notFound: 'Not found', notFoundBody: 'This item is no longer available.', browse: 'Browse the store', items: 'items', from: 'Delivered from', rating: 'ratings' },
  mr: { open: 'ॲपमध्ये उघडा', get: 'ॲप मिळवा', call: 'दुकानाला कॉल करा', wa: 'WhatsApp', out: 'स्टॉक संपला', inStock: 'स्टॉकमध्ये', mrp: 'MRP', off: 'सूट', notFound: 'सापडले नाही', notFoundBody: 'ही वस्तू आता उपलब्ध नाही.', browse: 'दुकान पहा', items: 'वस्तू', from: 'येथून डिलिव्हरी', rating: 'रेटिंग' },
  hi: { open: 'ऐप में खोलें', get: 'ऐप पाएँ', call: 'दुकान को कॉल करें', wa: 'WhatsApp', out: 'स्टॉक ख़त्म', inStock: 'स्टॉक में', mrp: 'MRP', off: 'छूट', notFound: 'नहीं मिला', notFoundBody: 'यह सामान अब उपलब्ध नहीं है।', browse: 'दुकान देखें', items: 'सामान', from: 'यहाँ से डिलीवरी', rating: 'रेटिंग' },
};
export const t = (lang) => T[lang] || T.en;

/** Android: open the installed app, or fall back to the Play Store / this page. */
export function appIntent(env, appPath, fallback) {
  const pkg = env.APP_PACKAGE || 'in.nearkart.app';
  return `intent://${appPath}#Intent;scheme=nearkart;package=${pkg};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}

export function storeButtons(env, store, lang) {
  const s = t(lang);
  const phone = store?.phone ? String(store.phone).replace(/[^\d+]/g, '') : '';
  const wa = phone.replace(/^\+/, '');
  return phone
    ? `<a class="btn ghost" href="tel:${esc(phone)}">📞 ${esc(s.call)}</a>
       <a class="btn ghost" href="https://wa.me/${esc(wa)}">💬 ${esc(s.wa)}</a>`
    : '';
}

export function page({ lang, title, description, image, url, body, jsonLd, status = 200 }) {
  const html = `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&family=Noto+Sans+Devanagari:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<header class="top"><a href="/" class="brand">NearKart</a>
<nav class="langs">${LANGS.map((l) => `<a href="?lang=${l}"${l === lang ? ' aria-current="true"' : ''}>${{ en: 'EN', mr: 'मराठी', hi: 'हिंदी' }[l]}</a>`).join('')}</nav></header>
<main>${body}</main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300',
    },
  });
}
