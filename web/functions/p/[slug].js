// /p/<slug>: product share page (WhatsApp preview, Google, "Open in app").
import { appIntent, esc, imageUrl, loc, page, pickLang, rpc, rupees, storeButtons, t } from '../../lib/render.js';

export async function onRequestGet({ params, request, env }) {
  const lang = pickLang(request);
  const s = t(lang);
  const url = new URL(request.url);
  const canonical = `${url.origin}/p/${encodeURIComponent(params.slug)}`;

  let data = null;
  let store = null;
  try {
    [data, store] = await Promise.all([
      rpc(env, 'get_product', { p_slug: params.slug }),
      rpc(env, 'store_status', {}),
    ]);
  } catch {
    data = null;
  }

  if (!data || !data.product) {
    return page({
      lang,
      status: 404,
      title: `${s.notFound} · NearKart`,
      description: s.notFoundBody,
      url: canonical,
      body: `<section class="card"><h1>${esc(s.notFound)}</h1><p>${esc(s.notFoundBody)}</p>
             <a class="btn" href="${esc(env.PLAY_URL || '/')}">${esc(s.browse)}</a></section>`,
    });
  }

  const p = data.product;
  const name = loc(p.name, lang);
  const v = data.variants.find((x) => x.is_default) || data.variants[0];
  const img = data.images?.[0];
  // Phase 7 uploads a 600×600 JPEG "_share" copy of the first photo for link previews.
  const sharePath = img?.path ? String(img.path).replace(/_full\.\w+$/, '_share.jpg') : null;
  const ogImage = imageUrl(env, sharePath) || imageUrl(env, img?.path);
  const inStock = v && v.available_qty > 0;
  const priceLine = v
    ? `${rupees(v.price)} · ${loc(v.label, lang)}${v.mrp > v.price ? ` (${s.mrp} ${rupees(v.mrp)}, ${v.discount_pct}% ${s.off})` : ''}`
    : '';
  const description = [priceLine, loc(p.description, lang)].filter(Boolean).join(' · ').slice(0, 200);
  const storeName = loc(data.seller?.name ?? store?.name, lang);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    image: ogImage ? [ogImage] : undefined,
    description: loc(p.description, lang) || undefined,
    brand: data.brand ? { '@type': 'Brand', name: loc(data.brand.name, 'en') } : undefined,
    sku: v?.sku,
    aggregateRating:
      p.rating_count > 0
        ? { '@type': 'AggregateRating', ratingValue: Number(p.rating_avg), reviewCount: p.rating_count }
        : undefined,
    offers: v
      ? {
          '@type': 'Offer',
          priceCurrency: 'INR',
          price: Number(v.price),
          availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: canonical,
          seller: { '@type': 'Organization', name: loc(data.seller?.name, 'en') },
        }
      : undefined,
  };

  const body = `
<section class="card product">
  ${ogImage ? `<img class="hero" src="${esc(imageUrl(env, img.path))}" alt="${esc(name)}">` : `<div class="hero placeholder">${esc(name.slice(0, 1))}</div>`}
  <p class="muted">${esc(loc(data.category?.name, lang))}</p>
  <h1>${esc(name)}</h1>
  ${data.brand ? `<p class="muted">${esc(loc(data.brand.name, lang))}</p>` : ''}
  ${p.rating_count > 0 ? `<p class="rating">★ ${Number(p.rating_avg).toFixed(1)} · ${p.rating_count} ${esc(s.rating)}</p>` : ''}
  ${v ? `<p class="price"><strong>${esc(rupees(v.price))}</strong> ${v.mrp > v.price ? `<s>${esc(rupees(v.mrp))}</s> <span class="off">${v.discount_pct}% ${esc(s.off)}</span>` : ''}</p>
  <p class="muted">${esc(loc(v.label, lang))} · ${esc(inStock ? s.inStock : s.out)}</p>` : ''}
  <div class="actions">
    <a class="btn" href="${esc(appIntent(env, `p/${params.slug}`, env.PLAY_URL || canonical))}">${esc(s.open)}</a>
    ${env.PLAY_URL ? `<a class="btn ghost" href="${esc(env.PLAY_URL)}">${esc(s.get)}</a>` : ''}
    ${storeButtons(env, store, lang)}
  </div>
  ${storeName ? `<p class="muted small">${esc(s.from)}: ${esc(storeName)}</p>` : ''}
</section>`;

  return page({ lang, title: `${name} · ${priceLine} · NearKart`, description, image: ogImage, url: canonical, body, jsonLd });
}
