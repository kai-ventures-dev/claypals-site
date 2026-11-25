// Offline suite: this checkout served at https://claypals.app from disk, every Google, Meta and
// PostHog URL answered with an empty stub, anything else off-site aborted. Nothing leaves the machine.
// Trackers are observed through the queues their own bootstrap snippets fill (fbq.queue, dataLayer,
// posthog._i), so this checks what we ask them to do, not what their real libraries then send.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const ROOT = process.env.ROOT || path.join(__dirname, '..');
const CONSENT = process.env.CONSENT;            // serve this file as assets/js/consent.js (red-run fixture)
const SHOTS = process.env.SHOTS;                // optional folder for full-page screenshots
const BASE = 'https://claypals.app';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const US = { timezoneId: 'America/Los_Angeles', locale: 'en-US' };
const EU = { timezoneId: 'Europe/Berlin', locale: 'de-DE' };
const TRACKER = /(googletagmanager\.com|google-analytics\.com|doubleclick\.net|google\.com\/(ccm|pagead)|facebook\.(com|net)|posthog\.com)/;
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml' };
const APPS = { '/': { id: '6794948298', store: 'https://apps.apple.com/us/app/claypals-toddler-puzzles/id6794948298', policy: '/privacy.html', items: 23 },
               '/produce/': { id: '6798962112', store: 'https://apps.apple.com/us/app/claypals-fruits-veggies/id6798962112', policy: '/produce/privacy.html', items: 28 } };
// A page that is neither landing nor legal but loads the shared consent file: PostHog must stay off it.
const OTHER = '<!doctype html><html><head><script src="/assets/js/consent.js"></script></head><body><p>other</p></body></html>';
const GRANTED_PH = { v: 1, status: 'granted', ph: 1 }, GRANTED_OLD = { v: 1, status: 'granted' };

let fails = 0; const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };
const kase = async (name, fn) => { console.log(name); try { await fn(); } catch (e) { ok(false, 'crashed: ' + String(e.message).split('\n')[0]); } };

async function session(b, geo, opts = {}) {
  const ctx = await b.newContext({ userAgent: UA, viewport: opts.viewport || { width: 1280, height: 900 }, ...geo });
  if (opts.stored) await ctx.addInitScript(`try { if (!localStorage.getItem('cp-consent')) localStorage.setItem('cp-consent', JSON.stringify(Object.assign(${JSON.stringify(opts.stored)}, { ts: new Date().toISOString() }))); } catch (e) {}`);
  const net = { hits: [], unexpected: [], missing: [] };
  await ctx.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin === BASE) {
      if (u.pathname === '/other.html') return r.fulfill({ status: 200, contentType: 'text/html', body: OTHER });
      let f = decodeURIComponent(u.pathname); if (f.endsWith('/')) f += 'index.html';
      const full = CONSENT && f === '/assets/js/consent.js' ? CONSENT : path.join(ROOT, f);
      if (!fs.existsSync(full)) { net.missing.push(f); return r.fulfill({ status: 404, body: '' }); }
      return r.fulfill({ status: 200, contentType: TYPES[path.extname(full)] || 'application/octet-stream', body: fs.readFileSync(full) });
    }
    if (TRACKER.test(u.href)) { net.hits.push(u.href); return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); }
    if (u.hostname !== 'apps.apple.com') net.unexpected.push(u.href);
    return r.abort();
  });
  const page = await ctx.newPage();
  const go = async p => { net.hits.length = 0; await page.goto(BASE + p, { waitUntil: 'load' }); await page.waitForTimeout(400); };
  const hit = re => net.hits.filter(u => re.test(u)).length;
  const loads = () => ({ ga: hit(/googletagmanager\.com\/gtag\/js/), meta: hit(/connect\.facebook\.net\/.*fbevents\.js/), ph: hit(/posthog\.com/) });
  const banner = () => page.locator('#cp-consent-banner').isVisible().catch(() => false);
  const bannerText = () => page.locator('#cp-consent-banner').innerText().catch(() => '');
  // What the page has asked each tracker to do so far.
  const asked = () => page.evaluate(() => ({
    fbq: typeof fbq === 'function' ? Array.from(fbq.queue, a => Array.from(a)) : null,
    gtag: (window.dataLayer || []).map(a => Array.from(a)).filter(a => a[0] === 'event').map(a => [a[1], a[2] && a[2].event_label]),
    ph: window.posthog ? { init: window.posthog._i || [], calls: Array.from(window.posthog) } : null,
    phKeys: [localStorage, sessionStorage].flatMap(s => Object.keys(s)).filter(k => /ph_/.test(k)),
    choice: JSON.parse(localStorage.getItem('cp-consent') || 'null'),
  }));
  const trackerCookies = async () => (await ctx.cookies()).map(c => c.name).filter(n => /^(_ga|_fbp|_fbc|ph_)/.test(n));
  // The click's own navigation is cancelled so the page stays readable; the tracking handler runs in the capture phase, before this.
  const clickStore = async () => { await page.evaluate(() => document.addEventListener('click', e => e.preventDefault())); await page.locator('a.btn[data-cta=hero]').click({ noWaitAfter: true }); await page.waitForTimeout(300); return asked(); };
  return { ctx, page, net, go, loads, banner, bannerText, asked, trackerCookies, clickStore };
}
const j = x => JSON.stringify(x);
const noneLoaded = l => l.ga === 0 && l.meta === 0 && l.ph === 0;
const gaMetaOnly = l => l.ga === 1 && l.meta === 1 && l.ph === 0;
const allThree = l => l.ga === 1 && l.meta === 1 && l.ph === 1;

(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });

  for (const p of Object.keys(APPS)) {
    const app = APPS[p]; let s, a;
    console.log(`\n######## ${p}`);

    await kase('A. US visitor, no stored choice: GA + pixel as before, never PostHog', async () => {
      s = await session(b, US); await s.go(p); a = await s.asked();
      ok(!(await s.banner()), 'no banner');
      ok(gaMetaOnly(s.loads()), `GA and pixel requested once each, PostHog not at all ${j(s.loads())}`);
      ok(a.ph === null && a.phKeys.length === 0, 'window.posthog never created, no ph_ storage');
      ok(j(a.fbq) === j([['init', '1693906458397139'], ['track', 'PageView']]), `pixel asked for init + PageView ${j(a.fbq)}`);
      a = await s.clickStore(); const vc = a.fbq.filter(q => q[1] === 'ViewContent');
      ok(vc.length === 1 && vc[0][2].value === 4.99 && vc[0][2].currency === 'USD' && j(vc[0][2].content_ids) === j([app.id]) && /^vc-/.test(vc[0][3].eventID), `App Store click: one ViewContent with value, currency, app id ${j(vc)}`);
      ok(j(a.gtag) === j([['app_store_click', 'hero']]), `App Store click: one GA app_store_click ${j(a.gtag)}`);
      ok(s.loads().ph === 0, 'still no PostHog after the click');
      await s.ctx.close(); });

    await kase('B. EU visitor, no stored choice: nothing before consent', async () => {
      s = await session(b, EU); await s.go(p); a = await s.asked(); const t = await s.bannerText();
      ok(await s.banner(), 'banner shown');
      ok(/Google Analytics, PostHog and the Meta Pixel/.test(t) && /Nothing loads unless you accept/.test(t) && /none of it is in the apps/.test(t), 'banner names all three services and says nothing loads');
      ok(s.net.hits.length === 0, `zero requests to Google, Meta or PostHog (${s.net.hits.length})`);
      ok(a.fbq === null && a.ph === null && a.phKeys.length === 0 && (await s.trackerCookies()).length === 0, 'no pixel, no PostHog, no tracker cookies or storage');
      ok((await s.page.locator('#cp-consent-banner a').getAttribute('href')) === app.policy + '#website', 'banner links to this app\'s policy, #website');
      a = await s.clickStore(); ok(a.fbq === null && s.net.hits.length === 0, 'App Store click sends nothing before consent');
      await s.ctx.close(); });

    await kase('C. EU visitor accepts: all three, PostHog pageview-only config', async () => {
      s = await session(b, EU); await s.go(p);
      await s.page.getByRole('button', { name: 'Accept' }).click(); await s.page.waitForTimeout(400); a = await s.asked();
      ok(!(await s.banner()) && allThree(s.loads()), `banner gone, each loaded once ${j(s.loads())}`);
      const cfg = a.ph && a.ph.init[0] && a.ph.init[0][1];
      ok(a.ph && a.ph.init.length === 1 && /^phc_/.test(a.ph.init[0][0]) && j(cfg) === j({ api_host: 'https://us.i.posthog.com', person_profiles: 'identified_only', respect_dnt: true, disable_session_recording: true, autocapture: false, capture_heatmaps: false, capture_dead_clicks: false, capture_performance: false, capture_exceptions: false, disable_surveys: true, disable_product_tours: true, disable_conversations: true }), `one posthog.init: no replay, autocapture, heatmaps, dead clicks, web vitals, exceptions, surveys, tours or chat widget; DNT respected ${j(cfg)}`);
      ok(!a.ph.calls.some(c => c[0] === 'identify' || c[0] === 'capture'), 'no identify() and no custom capture()');
      ok(a.choice.status === 'granted' && a.choice.ph === 1, 'stored choice records that PostHog was named');
      a = await s.clickStore(); ok(a.fbq.filter(q => q[1] === 'ViewContent').length === 1, 'App Store click: one ViewContent after Accept');
      await s.go(p); ok(!(await s.banner()) && allThree(s.loads()), 'next visit: remembered, all three load');
      await s.go(p + 'index.html'); ok(allThree(s.loads()), `${p}index.html counts as the same landing page`);
      const other = p === '/' ? '/produce/' : '/'; await s.go(other); ok(allThree(s.loads()), `${other}: remembered there too`);
      await s.go('/other.html'); ok(gaMetaOnly(s.loads()), `a non-landing page that loads consent.js: no PostHog ${j(s.loads())}`);
      await s.ctx.close(); });

    await kase('D. EU visitor declines: nothing, now or later', async () => {
      s = await session(b, EU); await s.go(p);
      await s.page.getByRole('button', { name: 'Decline' }).click(); await s.page.waitForTimeout(400);
      ok(!(await s.banner()) && s.net.hits.length === 0, 'banner gone, zero tracker requests');
      await s.go(p); a = await s.asked();
      ok(!(await s.banner()) && s.net.hits.length === 0 && a.ph === null && a.fbq === null, 'next visit: remembered, nothing loads');
      await s.ctx.close(); });

    await kase('E. revoke after Accept: PostHog told to stop, its cookie and storage cleared, reload is clean', async () => {
      s = await session(b, EU); await s.go(p);
      await s.page.getByRole('button', { name: 'Accept' }).click(); await s.page.waitForTimeout(400);
      // The stubs set nothing, so plant what the real libraries would have left behind.
      await s.ctx.addCookies(['_ga', '_ga_KVS5B771EK', '_fbp', 'ph_phc_test_posthog'].map(name => ({ name, value: 'x', url: BASE })));
      await s.page.evaluate(() => { localStorage.setItem('ph_phc_test_posthog', '{}'); localStorage.setItem('__ph_opt_in_out_phc_test', '0'); sessionStorage.setItem('ph_phc_test_window_id', 'w'); });
      await s.page.getByRole('button', { name: 'Privacy choices' }).click(); await s.page.waitForTimeout(300); const t = await s.bannerText();
      ok(/uses Google Analytics, PostHog and the Meta Pixel/.test(t) && !/Nothing loads/.test(t), 'reopened banner says all three are running');
      // The page reloads on Decline, so note the opt-out call somewhere that survives it.
      await s.page.evaluate(() => { const real = posthog.opt_out_capturing; posthog.opt_out_capturing = function () { sessionStorage.setItem('saw-opt-out', '1'); return real.apply(this, arguments); }; });
      s.net.hits.length = 0;
      await Promise.all([s.page.waitForEvent('load', { timeout: 8000 }), s.page.getByRole('button', { name: 'Decline' }).click()]);
      await s.page.waitForTimeout(400); a = await s.asked();
      ok((await s.page.evaluate(() => sessionStorage.getItem('saw-opt-out'))) === '1', 'posthog.opt_out_capturing() was called');
      ok(s.net.hits.length === 0 && a.ph === null && a.fbq === null && !(await s.banner()), `page reloaded with nothing loaded (${s.net.hits.length} tracker requests)`);
      // PostHog's own opt-out marker has to outlive the reload: without it the real library sends a $pageleave as the page unloads.
      ok((await s.trackerCookies()).length === 0 && j(a.phKeys) === j(['__ph_opt_in_out_phc_test']), `tracker cookies and ph_ storage cleared, opt-out marker kept (${j(await s.trackerCookies())} ${j(a.phKeys)})`);
      ok(a.choice.status === 'denied', 'denial stored');
      await s.go(p); ok(s.net.hits.length === 0, 'next visit: nothing loads');
      await s.page.getByRole('button', { name: 'Privacy choices' }).click(); await s.page.getByRole('button', { name: 'Accept' }).click(); await s.page.waitForTimeout(400); a = await s.asked();
      ok(allThree(s.loads()) && a.phKeys.length === 0, `a later Accept loads all three and drops the opt-out marker (${j(a.phKeys)})`);
      await s.ctx.close(); });

    await kase('F. US visitor opts in through "Privacy choices": PostHog only after that Accept', async () => {
      s = await session(b, US); await s.go(p);
      await s.page.getByRole('button', { name: 'Privacy choices' }).click(); await s.page.waitForTimeout(300); const t = await s.bannerText();
      ok(/uses Google Analytics and the Meta Pixel/.test(t) && /Accept also turns on PostHog/.test(t) && !/Nothing loads/.test(t), 'banner says GA and the pixel are running and that Accept adds PostHog');
      ok(s.loads().ph === 0, 'opening the banner loads no PostHog');
      await s.page.getByRole('button', { name: 'Accept' }).click(); await s.page.waitForTimeout(400);
      ok(allThree(s.loads()) && !(await s.banner()), `Accept adds PostHog, GA and pixel not loaded twice ${j(s.loads())}`);
      await s.ctx.close(); });

    await kase('G. US visitor declines through "Privacy choices"', async () => {
      s = await session(b, US); await s.go(p);
      await s.page.getByRole('button', { name: 'Privacy choices' }).click(); s.net.hits.length = 0;
      await Promise.all([s.page.waitForEvent('load', { timeout: 8000 }), s.page.getByRole('button', { name: 'Decline' }).click()]);
      await s.page.waitForTimeout(400); a = await s.asked();
      ok(s.net.hits.length === 0 && a.fbq === null && a.ph === null, 'reloaded with nothing loaded');
      a = await s.clickStore(); ok(a.fbq === null && s.net.hits.length === 0, 'App Store click sends nothing after Decline');
      await s.ctx.close(); });

    await kase('H. an Accept stored before PostHog existed does not load PostHog', async () => {
      s = await session(b, EU, { stored: GRANTED_OLD }); await s.go(p);
      ok(gaMetaOnly(s.loads()) && !(await s.banner()), `GA and pixel load as before, PostHog does not ${j(s.loads())}`);
      await s.ctx.close(); });

    await kase('S. structured data, FAQ parity, head tags, links, assets', async () => {
      s = await session(b, US); await s.go(p);
      await s.page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } });
      await s.page.waitForTimeout(500);
      const d = await s.page.evaluate(() => ({
        ld: Array.from(document.querySelectorAll('script[type="application/ld+json"]'), e => e.textContent),
        faq: Array.from(document.querySelectorAll('#faq details'), e => [e.querySelector('summary h3').textContent.trim(), e.querySelector(':scope > p').textContent.trim(), e.children.length]),
        canonical: document.querySelector('link[rel=canonical]').href, ogUrl: document.querySelector('meta[property="og:url"]').content,
        appTag: document.querySelector('meta[name="apple-itunes-app"]').content,
        title: document.title, desc: document.querySelector('meta[name=description]').content,
        cta: Array.from(document.querySelectorAll('a[href*="apps.apple.com"]'), e => [e.dataset.cta, e.href]),
        badImg: Array.from(document.images).filter(i => !(i.complete && i.naturalWidth > 0)).map(i => i.currentSrc || i.src),
        offsite: Array.from(document.querySelectorAll('img,source,video,link[rel=stylesheet],link[rel=preload],script[src]'), e => e.currentSrc || e.src || e.href || '').filter(u => u && !u.startsWith(location.origin + '/')),
        local: Array.from(document.querySelectorAll('a[href]'), e => e.href).filter(u => u.startsWith(location.origin + '/')),
        aeo: getComputedStyle(document.querySelector('#faq')).backgroundColor !== 'rgba(0, 0, 0, 0)',
        shelf: [document.querySelectorAll('#shelf li').length, document.querySelectorAll('#shelf li.in').length],
      }));
      let graph = [], faq = null, parsed = true;
      try { const docs = d.ld.map(t => JSON.parse(t)); graph = docs[0]['@graph']; faq = docs[1]; } catch (e) { parsed = false; }
      ok(parsed && d.ld.length === 2 && graph.every(n => n['@type']) && faq['@context'] === 'https://schema.org' && faq['@type'] === 'FAQPage', 'two JSON-LD blocks parse: a schema.org @graph and a FAQPage');
      ok(j(graph.map(n => n['@type'])) === j(['Organization', 'WebSite', 'WebPage', 'MobileApplication']), `graph nodes ${j(graph.map(n => n['@type']))}`);
      // An object holding only @id is a reference; one with more keys defines that id.
      const ids = new Set(), refs = [];
      (function walk(n) { if (!n || typeof n !== 'object') return; const k = Object.keys(n); if (n['@id']) { if (k.length === 1) refs.push(n['@id']); else ids.add(n['@id']); } k.forEach(x => walk(n[x])); })(graph);
      ok(refs.length > 0 && refs.every(r => ids.has(r)), `every @id reference resolves inside the graph (${refs.length} refs)`);
      const m = graph[3], w = graph[2];
      ok(m.installUrl === app.store && j(m.sameAs) === j([app.store]) && m.url === BASE + p && w.url === BASE + p && m.operatingSystem && m.applicationCategory, 'MobileApplication points at this app\'s App Store listing and this page');
      ok(j(m.offers.map(o => [o['@type'], o.price, o.priceCurrency])) === j([['Offer', '0', 'USD'], ['Offer', '4.99', 'USD']]), 'two offers: free download and the 4.99 USD unlock');
      ok(/^\d{4}-\d{2}-\d{2}$/.test(w.dateModified), `WebPage.dateModified is a date (${w.dateModified}; set to the deploy date before merge)`);
      const ldFaq = faq.mainEntity.map(q => [q.name, q.acceptedAnswer.text]);
      ok(faq.mainEntity.every(q => q['@type'] === 'Question' && q.acceptedAnswer['@type'] === 'Answer') && ldFaq.length === 12 && d.faq.every(f => f[2] === 2), '12 questions, each one summary and one answer');
      ok(j(ldFaq) === j(d.faq.map(f => [f[0], f[1]])), 'FAQPage JSON-LD equals the visible FAQ, character for character');
      ok(d.canonical === BASE + p && d.ogUrl === BASE + p, `canonical and og:url ${d.canonical}`);
      ok(d.appTag === 'app-id=' + app.id, `apple-itunes-app ${d.appTag}`);
      ok(d.title.length <= 60 && d.desc.length <= 160 && d.desc.includes(String(app.items)), `title ${d.title.length} chars, description ${d.desc.length} chars`);
      ok(j(d.cta) === j([['hero', app.store], ['closing', app.store], ['footer', app.store]]), 'three App Store links (hero, closing, footer), all to this app');
      const offsite = d.offsite.filter(u => !TRACKER.test(u)).concat(s.net.unexpected);   // the two tracker scripts are the stubs
      ok(offsite.length === 0, `no off-site asset or request ${j(offsite)}`);
      ok(d.shelf[0] === app.items && d.shelf[1] === app.items, `roster shows all ${app.items} items once scrolled to (${d.shelf})`);
      ok(d.badImg.length === 0 && s.net.missing.length === 0 && d.aeo, `every image decoded, no 404, aeo.css applied ${j(d.badImg.concat(s.net.missing))}`);
      const dead = [...new Set(d.local)].filter(u => { const x = new URL(u); let f = decodeURIComponent(x.pathname); if (f.endsWith('/')) f += 'index.html'; return !fs.existsSync(path.join(ROOT, f)); });
      ok(dead.length === 0 && d.local.some(u => u.endsWith('#faq')), `every on-site link has a file behind it ${j(dead)}`);
      await s.ctx.close(); });

    for (const [name, viewport] of [['phone', { width: 375, height: 667 }], ['tablet', { width: 768, height: 1024 }], ['desktop', { width: 1280, height: 900 }]]) {
      await kase(`V. layout at ${viewport.width}x${viewport.height}`, async () => {
        s = await session(b, US, { viewport }); await s.go(p);
        const cta = await s.page.locator('a.btn[data-cta=hero]').boundingBox();
        await s.page.locator('#faq').scrollIntoViewIfNeeded(); await s.page.locator('#faq summary').first().click();
        const r = await s.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, open: document.querySelector('#faq details').open,
          wide: Array.from(document.querySelectorAll('#faq details, footer li, footer p')).filter(e => { const q = e.getBoundingClientRect(); return q.right > innerWidth + 1 || q.left < -1; }).length }));
        ok(r.sw <= r.cw && r.wide === 0, `no sideways scroll, FAQ and footer inside the viewport (${r.sw} <= ${r.cw})`);
        ok(r.open, 'a FAQ question opens on click');
        ok(cta && cta.y + cta.height <= viewport.height, `hero App Store button is on the first screen (bottom ${cta && Math.round(cta.y + cta.height)} of ${viewport.height})`);
        // The reopened banner carries the longest copy ("Accept also turns on PostHog").
        await s.page.getByRole('button', { name: 'Privacy choices' }).click(); await s.page.waitForTimeout(300);
        const bn = await s.page.locator('#cp-consent-banner').boundingBox(), dec = await s.page.getByRole('button', { name: 'Decline' }).boundingBox();
        ok(bn && dec && bn.height <= viewport.height / 2 && bn.x >= 0 && bn.x + bn.width <= viewport.width && dec.y + dec.height <= viewport.height, `reopened banner fits: ${bn && Math.round(bn.height)}px tall, both buttons on screen`);
        if (SHOTS) await s.page.screenshot({ path: path.join(SHOTS, `${p === '/' ? 'home' : 'produce'}-${name}-banner.png`) });
        if (SHOTS) {   // scroll-triggered reveals are forced on: a full-page capture never scrolls past them
          const stem = path.join(SHOTS, `${p === '/' ? 'home' : 'produce'}-${name}`);
          await s.page.addStyleTag({ content: '.reveal,.shelf li{opacity:1!important;transform:none!important}' });
          await s.page.screenshot({ path: stem + '.png', fullPage: true });
          for (const part of ['#faq', 'footer', '.hero']) if (await s.page.locator(part).count()) await s.page.locator(part).first().screenshot({ path: `${stem}-${part.replace(/\W/g, '')}.png` });
        }
        await s.ctx.close(); });
    }
  }

  await kase('\nL. legal pages: no scripts, no trackers, whatever was chosen', async () => {
    for (const [label, geo, stored] of [['US', US], ['EU', EU], ['EU, accepted with PostHog', EU, GRANTED_PH]]) for (const p of ['/privacy.html', '/produce/privacy.html', '/produce/terms.html']) {
      const s = await session(b, geo, { stored }); await s.go(p);
      const n = await s.page.evaluate(() => document.scripts.length);
      ok(n === 0 && s.net.hits.length === 0 && s.net.unexpected.length === 0 && !(await s.banner()), `${label} ${p}: ${n} scripts, ${s.net.hits.length} tracker requests`);
      await s.ctx.close();
    } });

  await kase('P. privacy pages: website analytics disclosed under "About this website" only', async () => {
    for (const p of ['/privacy.html', '/produce/privacy.html']) {
      const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
      const sec = (html.match(/<section id="website">[\s\S]*?<\/section>/) || [''])[0], rest = html.replace(sec, '');
      ok(/<h2>About this website<\/h2>/.test(sec) && ['Google Analytics 4', 'Meta Pixel', 'PostHog'].every(x => sec.includes(x)) && /only\s+after you press Accept/.test(sec) && /None of that is in the app/.test(sec), `${p}: section names all three and says PostHog needs Accept`);
      ok(!/PostHog|Google Analytics|Meta Pixel|posthog/.test(rest), `${p}: none of them named outside that section`);
    } });

  await kase('R. robots.txt, sitemap.xml, llms.txt', async () => {
    const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
    const onDisk = u => { let f = new URL(u).pathname; if (f.endsWith('/')) f += 'index.html'; return fs.existsSync(path.join(ROOT, f)); };
    const locs = Array.from(read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g), m => m[1]);
    ok(j(locs) === j(['/', '/produce/', '/privacy.html', '/produce/privacy.html', '/produce/terms.html'].map(x => BASE + x)) && locs.every(onDisk), `sitemap lists the five pages, each on disk`);
    ok(/^Sitemap: https:\/\/claypals\.app\/sitemap\.xml$/m.test(read('robots.txt')) && !/^Disallow/m.test(read('robots.txt')), 'robots.txt names the sitemap and disallows nothing');
    const links = Array.from(read('llms.txt').matchAll(/\]\((https:\/\/claypals\.app[^)]*)\)/g), m => m[1]);
    ok(links.length >= 6 && links.every(onDisk) && Object.values(APPS).every(x => read('llms.txt').includes(x.store)), `llms.txt: ${links.length} on-site links resolve, both App Store links present`);
    ok(fs.readFileSync(path.join(ROOT, 'CNAME'), 'utf8').trim() === 'claypals.app', 'CNAME is claypals.app');
  });

  await b.close();
  console.log(fails ? `\nRED: ${fails} failure(s)` : '\nGREEN'); process.exit(fails ? 1 : 0);
})();
