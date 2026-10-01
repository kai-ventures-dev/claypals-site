// Consent behaviour suite. Real Chrome, normal UA (Meta drops HeadlessChrome). Google + Meta
// requests are BLOCKED at the network layer and only observed via CDP: nothing leaves this machine.
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:8411';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const US = { timezoneId: 'America/Los_Angeles', locale: 'en-US' };
const EU = { timezoneId: 'Europe/Berlin', locale: 'de-DE' };
const GB_LANG = { timezoneId: 'America/New_York', locale: 'en-GB' };
let fails = 0; const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };
const kase = async (name, fn) => { console.log(name); try { await fn(); } catch (e) { ok(false, 'crashed: ' + String(e.message).split('\n')[0]); } };

async function session(b, geo, opts = {}) {
  const ctx = await b.newContext({ userAgent: UA, viewport: opts.viewport || { width: 1280, height: 900 }, ...geo });
  if (opts.clock) await ctx.addInitScript(`(() => { const t = ${Date.parse(opts.clock)}; const D = Date; Date.now = () => t; })()`);
  if (process.env.LOCALROOT) {
    const fs = require('fs'), path = require('path');
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2' };
    await ctx.route('https://claypals.app/**', r => {
      let f = decodeURIComponent(new URL(r.request().url()).pathname); if (f.endsWith('/')) f += 'index.html';
      const full = path.join(process.env.LOCALROOT, f);
      if (!fs.existsSync(full)) return r.fulfill({ status: 404, body: '' });
      r.fulfill({ status: 200, contentType: types[path.extname(full)] || 'application/octet-stream', body: fs.readFileSync(full) });
    });
  }
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*googletagmanager*', '*google-analytics*', '*facebook.com/tr*', '*facebook.com/privacy_sandbox*', '*on.aws*', '*run.app*', '*apps.apple.com*'] });
  const net = { gtag: 0, fbevents: 0, events: [] };
  cdp.on('Network.requestWillBeSent', e => {
    const u = e.request.url;
    if (/googletagmanager\.com\/gtag\/js/.test(u)) net.gtag++;
    if (/connect\.facebook\.net\/.*fbevents\.js/.test(u)) net.fbevents++;
    if (/facebook\.com\/tr/.test(u)) { const q = new URLSearchParams((u.split('?')[1] || '') + '&' + (e.request.postData || '')); if (q.get('ev')) net.events.push({ ev: q.get('ev'), value: q.get('cd[value]'), cur: q.get('cd[currency]'), ids: q.get('cd[content_ids]') }); }
  });
  const reset = () => { net.gtag = 0; net.fbevents = 0; net.events = []; };
  const go = async p => { reset(); await page.goto(BASE + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); };
  const banner = () => page.locator('#cp-consent-banner').isVisible().catch(() => false);
  const trackerCookies = async () => (await ctx.cookies()).map(c => c.name).filter(n => /^(_ga|_fbp|_fbc)/.test(n));
  const clickStore = async () => { net.events = []; await page.locator('a.btn[data-cta=hero]').click({ noWaitAfter: true }); await page.waitForTimeout(2500); return net.events.filter(e => e.ev === 'ViewContent'); };
  return { ctx, page, net, go, banner, trackerCookies, clickStore };
}
const loadedAll = n => n.gtag >= 1 && n.fbevents >= 1 && n.events.some(e => e.ev === 'PageView');
const loadedNone = n => n.gtag === 0 && n.fbevents === 0 && n.events.length === 0;

(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--disable-blink-features=AutomationControlled'] });
  for (const path of ['/', '/produce/']) {
    const id = path === '/' ? '6794948298' : '6798962112';
    console.log(`\n######## ${path}`);

    let s, vc;
    await kase('A. US visitor, no stored choice', async () => {
    s = await session(b, US); await s.go(path);
    ok(!(await s.banner()), 'no banner'); ok(loadedAll(s.net), `GA + pixel load, PageView fires (gtag=${s.net.gtag} fbevents=${s.net.fbevents} events=${s.net.events.map(e => e.ev)})`);
    vc = await s.clickStore(); ok(vc.length === 1 && vc[0].value === '1.99' && vc[0].cur === 'USD' && vc[0].ids === `["${id}"]`, `one ViewContent ${JSON.stringify(vc)}`);
    await s.ctx.close(); });

    await kase('B. EU visitor, no stored choice', async () => {
    s = await session(b, EU); await s.go(path);
    ok(await s.banner(), 'banner shown');
    const txt = await s.page.locator('#cp-consent-banner').innerText().catch(() => '');
    ok(/Google Analytics and the Meta Pixel/.test(txt) && /measure and target our ads/.test(txt) && /Nothing loads unless you accept/.test(txt), 'banner names both services, says ads are targeted, says nothing loads');
    ok(loadedNone(s.net), `NOTHING loads (gtag=${s.net.gtag} fbevents=${s.net.fbevents} events=${s.net.events.length})`);
    ok((await s.trackerCookies()).length === 0, 'no _ga/_fbp/_fbc cookies');
    const href = await s.page.locator('#cp-consent-banner a').getAttribute('href');
    ok(href === (path === '/' ? '/privacy.html#website' : '/produce/privacy.html#website'), `banner links to ${href}`);
    vc = await s.clickStore(); ok(vc.length === 0, 'App Store click sends no Meta event before consent');
    await s.ctx.close(); });

    await kase('C. EU visitor accepts', async () => {
    s = await session(b, EU); await s.go(path); s.net.gtag = 0; s.net.fbevents = 0; s.net.events = [];
    await s.page.getByRole('button', { name: 'Accept' }).click(); await s.page.waitForTimeout(2500);
    ok(!(await s.banner()), 'banner gone'); ok(loadedAll(s.net), `GA + pixel load after Accept (events=${s.net.events.map(e => e.ev)})`);
    vc = await s.clickStore(); ok(vc.length === 1 && vc[0].value === '1.99', `one ViewContent after Accept ${JSON.stringify(vc)}`);
    await s.go(path); ok(!(await s.banner()) && loadedAll(s.net), 'next visit: remembered, no banner, trackers load');
    await s.ctx.close(); });

    await kase('D. EU visitor declines', async () => {
    s = await session(b, EU); await s.go(path);
    await s.page.getByRole('button', { name: 'Decline' }).click(); await s.page.waitForTimeout(1500);
    ok(!(await s.banner()) && loadedNone(s.net), 'banner gone, still nothing loaded');
    await s.go(path); ok(!(await s.banner()) && loadedNone(s.net), 'next visit: remembered, no banner, nothing loads');
    ok((await s.trackerCookies()).length === 0, 'no tracker cookies');
    await s.ctx.close(); });

    await kase('E. US visitor uses "Privacy choices" -> Decline', async () => {
    s = await session(b, US); await s.go(path + '?fbclid=test123');
    // GA is blocked in this harness, so plant the cookies it would have set.
    await s.ctx.addCookies([{ name: '_ga', value: 'GA1.1.123.456', url: BASE }, { name: '_ga_KVS5B771EK', value: 'GS1.1.1', url: BASE }]);
    const before = await s.trackerCookies();
    await s.page.getByRole('button', { name: 'Privacy choices' }).click(); await s.page.waitForTimeout(400);
    ok(await s.banner(), 'footer button reopens banner');
    const txt = await s.page.locator('#cp-consent-banner').innerText().catch(() => '');
    ok(/uses Google Analytics and the Meta Pixel/.test(txt) && !/Nothing loads/.test(txt), 'reopened banner says what is running, not "nothing loads"');
    s.net.gtag = 0; s.net.fbevents = 0; s.net.events = [];
    await Promise.all([s.page.waitForEvent('load', { timeout: 8000 }), s.page.getByRole('button', { name: 'Decline' }).click()]);
    await s.page.waitForTimeout(1500);
    ok(loadedNone(s.net) && !(await s.banner()), `Decline reloads the page with nothing loaded (gtag=${s.net.gtag} fbevents=${s.net.fbevents})`);
    const after = await s.trackerCookies();
    ok(before.includes('_ga') && before.includes('_fbp') && after.length === 0, `tracker cookies cleared (${before.join(',')} -> ${after.join(',') || 'none'})`);
    vc = await s.clickStore(); ok(vc.length === 0, `no ViewContent after Decline (got ${vc.length})`);
    await s.go(path); ok(!(await s.banner()) && loadedNone(s.net), 'next visit: nothing loads');
    await s.ctx.close(); });

    await kase('K. no consent click ever reaches Meta (US: Privacy choices -> Decline)', async () => {
    s = await session(b, US); await s.go(path);
    s.net.events = [];
    await s.page.getByRole('button', { name: 'Privacy choices' }).click(); await s.page.waitForTimeout(800);
    const afterReopen = s.net.events.map(e => e.ev);
    await Promise.all([s.page.waitForEvent('load', { timeout: 8000 }), s.page.getByRole('button', { name: 'Decline' }).click()]);
    await s.page.waitForTimeout(1500);
    ok(afterReopen.length === 0, `opening Privacy choices sent nothing to Meta (${afterReopen.join(',') || 'none'})`);
    ok(s.net.events.length === 0, `Decline sent nothing to Meta (${s.net.events.map(e => e.ev).join(',') || 'none'})`);
    await s.ctx.close(); });

    await kase('L. reopening Privacy choices keeps an earlier Decline', async () => {
    s = await session(b, US); await s.go(path);
    await Promise.all([s.page.waitForEvent('load', { timeout: 8000 }), (async () => { await s.page.getByRole('button', { name: 'Privacy choices' }).click(); await s.page.getByRole('button', { name: 'Decline' }).click(); })()]);
    await s.page.waitForTimeout(800);
    await s.page.getByRole('button', { name: 'Privacy choices' }).click(); await s.page.waitForTimeout(400);
    const other = path === '/' ? '/produce/' : '/';
    await s.go(other); ok(loadedNone(s.net) && !(await s.banner()), `left without choosing -> ${other}: still nothing loads`);
    await s.ctx.close(); });

    await kase('F. US timezone, en-GB browser language', async () => {
    s = await session(b, GB_LANG); await s.go(path);
    ok(await s.banner() && loadedNone(s.net), 'banner shown, nothing loads');
    await s.ctx.close(); });

    await kase('I. EEA places outside Europe/* in the tz database', async () => {
    for (const tz of ['Asia/Nicosia', 'Indian/Reunion', 'America/Martinique', 'Africa/Ceuta']) {
      s = await session(b, { timezoneId: tz, locale: 'en-US' }); await s.go(path);
      ok(await s.banner() && loadedNone(s.net), `${tz} + en-US: banner, nothing loads`); await s.ctx.close();
    }
    s = await session(b, { timezoneId: 'America/Chicago', locale: 'en-US' }); await s.go(path);
    ok(!(await s.banner()) && loadedAll(s.net), 'control America/Chicago + en-US: no banner, loads'); await s.ctx.close(); });

    await kase('J. banner never hides the footer (375x667)', async () => {
    s = await session(b, EU, { viewport: { width: 375, height: 667 } }); await s.go(path);
    await s.page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await s.page.waitForTimeout(500);
    const r = await s.page.evaluate(() => { const f = document.querySelector('.linkbtn').getBoundingClientRect(); const bn = document.getElementById('cp-consent-banner').getBoundingClientRect(); return [Math.round(f.bottom), Math.round(bn.top)]; });
    ok(r[0] <= r[1], `"Privacy choices" bottom ${r[0]} is above banner top ${r[1]}`);
    await s.ctx.close(); });

    await kase('H. after the promo (2026-10-10T00:00:00Z)', async () => {
    s = await session(b, US, { clock: '2026-10-10T00:00:00Z' }); await s.go(path);
    vc = await s.clickStore(); ok(vc.length === 1 && vc[0].value === '4.99', `value ${vc[0] && vc[0].value}`);
    await s.ctx.close(); });
  }
  console.log('\nG. legal pages never load trackers');
  for (const geo of [US, EU]) for (const p of ['/privacy.html', '/produce/privacy.html', '/produce/terms.html']) {
    const s = await session(b, geo); await s.go(p);
    ok(loadedNone(s.net) && !(await s.banner()), `${geo.timezoneId} ${p}`);
    await s.ctx.close();
  }
  await b.close();
  console.log(fails ? `\nRED: ${fails} failure(s)` : '\nGREEN'); process.exit(fails ? 1 : 0);
})();
