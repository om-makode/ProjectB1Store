// /c/<slug>: category share page with the first products.
import { appIntent, esc, imageUrl, loc, page, pickLang, rpc, rupees, select, storeButtons, t } from '../../lib/render.js';

export async function onRequestGet({ params, request, env }) {
  const lang = pickLang(request);
  const s = t(lang);
  const url = new URL(request.url);
  const canonical = `${url.origin}/c/${encodeURIComponent(params.slug)}`;

  let cat = null;
  let list = null;
  let store = null;
  try {
    const rows = await select(
      env,
      `categories?select=id,slug,name,image_path&is_active=eq.true&slug=eq.${encodeURIComponent(params.slug)}&limit=1`,
    );
    cat = rows[0] ?? null;
    if (cat) {
      [list, store] = await Promise.all([
        rpc(env, 'list_products', { p_category_id: cat.id, p_page: 0, p_size: 24 }),
        rpc(env, 'store_status', {}),
      ]);
    }
  } catch {
    cat = null;
  }

  if (!cat) {
    return page({
      lang,
      status: 404,
      title: `${s.notFound} · NearKart`,
      description: s.notFoundBody,
      url: canonical,
      body: `<section class="card"><h1>${esc(s.notFound)}</h1><a class="btn" href="${esc(env.PLAY_URL || '/')}">${esc(s.browse)}</a></section>`,
    });
  }

  const name = loc(cat.name, lang);
  const items = list?.items ?? [];
  const grid = items
    .map(
      (p) => `<a class="tile" href="/p/${encodeURIComponent(p.slug)}?lang=${lang}">
        ${p.thumb_path ? `<img src="${esc(imageUrl(env, p.thumb_path))}" alt="" loading="lazy">` : `<div class="placeholder">${esc(loc(p.name, lang).slice(0, 1))}</div>`}
        <span class="name">${esc(loc(p.name, lang))}</span>
        <span class="muted small">${esc(loc(p.variant?.label, lang))}</span>
        <strong>${esc(rupees(p.variant?.price ?? 0))}</strong></a>`,
    )
    .join('');

  const body = `
<section class="card">
  <h1>${esc(name)}</h1>
  <p class="muted">${items.length} ${esc(s.items)}</p>
  <div class="actions">
    <a class="btn" href="${esc(appIntent(env, `c/${params.slug}`, env.PLAY_URL || canonical))}">${esc(s.open)}</a>
    ${storeButtons(env, store, lang)}
  </div>
</section>
<section class="grid">${grid}</section>`;

  return page({
    lang,
    title: `${name} · NearKart`,
    description: `${name}: ${items.slice(0, 5).map((p) => loc(p.name, lang)).join(', ')}`,
    image: imageUrl(env, cat.image_path),
    url: canonical,
    body,
  });
}
