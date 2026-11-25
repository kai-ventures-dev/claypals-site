// Offline Chromium checks for the website-only AEO and timed promo intersection.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = 'https://claypals.app';
const types = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.mp4':'video/mp4','.webm':'video/webm','.txt':'text/plain','.xml':'application/xml'};
const apps = [
  {route:'/',id:'6794948298',count:23,bf:'$0.99 once',legal:'/privacy.html'},
  {route:'/produce/',id:'6798962112',count:28,bf:'Free',legal:'/produce/privacy.html'},
];
const cases = [
  ['2026-11-27T03:59:59.999Z',null], ['2026-11-27T04:00:00Z','Black Friday'],
  ['2026-11-29T03:59:59.999Z','Black Friday'], ['2026-11-29T04:00:00Z','Cyber Monday'],
  ['2026-12-07T03:59:59.999Z','Cyber Monday'], ['2026-12-07T04:00:00Z',null],
  ['2026-12-07T04:00:00.001Z',null,'?promo_now=2026-11-27T04:01:00Z'],
];
const tracker = u => /(?:googletagmanager\.com|google-analytics\.com|facebook\.net|facebook\.com|posthog\.com)$/.test(u.hostname);
async function session(browser, config = {}) {
  const c = await browser.newContext(config);
  const requests = [];
  const missing = [];
  await c.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== origin) {
      requests.push(u.href);
      return tracker(u) ? r.fulfill({status:200,contentType:'application/javascript',body:''}) : r.abort();
    }
    const file = path.resolve(root, u.pathname.slice(1)+(u.pathname.endsWith('/')?'index.html':''));
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file)) {
      missing.push(u.pathname);
      return r.fulfill({status:404, body:''});
    }
    return r.fulfill({status:200,contentType:types[path.extname(file)] || 'application/octet-stream',body:fs.readFileSync(file)});
  });
  return {c,requests,missing};
}
const hasTracker = (requests, host) => requests.some(s=>new URL(s).hostname.endsWith(host));
async function waitRequest(requests, host) {
  for (let i=0;i<50 && !hasTracker(requests,host);i++) await new Promise(r=>setTimeout(r,40));
  assert.ok(hasTracker(requests,host),'expected stubbed load '+host);
}
async function read(page) {
  return page.evaluate(() => {
    const banner=document.querySelector('.cp-bfcm');
    const [graph,faq]=[...document.querySelectorAll('script[type="application/ld+json"]')].map(el=>JSON.parse(el.textContent));
    const links=[...document.querySelectorAll('a[data-cta]')].map(e=>e.href);
    return {
      text:banner?.innerText||null, promoLink:banner?.querySelector('a')?.href||null,
      promoNote:document.querySelectorAll('.cp-bfcm-note').length,
      price:[...document.querySelectorAll('.price-split .amount')].map(el=>el.textContent.trim()),
      styles:document.querySelectorAll('style[data-cp-bfcm]').length,
      graph,faq,links, questions:[...document.querySelectorAll('#faq details')].map(e=>[e.querySelector('h3').textContent,e.querySelector('p').textContent]),
      canonical:document.querySelector('link[rel="canonical"]').href,
      og:document.querySelector('meta[property="og:url"]').content,
      appTag:document.querySelector('meta[name="apple-itunes-app"]').content,
      meta:document.querySelector('meta[name="description"]').content,
      overflow:document.documentElement.scrollWidth>window.innerWidth,
      faqBackground:getComputedStyle(document.querySelector('#faq')).backgroundColor,
    };
  });
}
(async()=>{
  const b=await chromium.launch({executablePath:process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking','--disable-sync','--no-first-run']});
  let loads=0, layouts=0, tiles=0, consent=0;
  try {
    for(const app of apps) {
      const s=await session(b,{viewport:{width:1280,height:900}, timezoneId:'Pacific/Honolulu',locale:'en-US'});
      const pg=await s.c.newPage();
      for(const [instant,period,query=''] of cases) {
        await pg.clock.setFixedTime(new Date(instant));
        assert.equal((await pg.goto(origin+app.route+query,{waitUntil:'domcontentloaded'})).status(),200);
        const d=await read(pg);
        assert.equal(d.canonical,origin+app.route); assert.equal(d.og,d.canonical);
        assert.equal(d.appTag,'app-id='+app.id);
        assert.ok(d.links.length===3&&d.links.every(url=>url.endsWith('/id'+app.id)));
        assert.ok(d.meta.length<=160&&d.meta.includes(String(app.count))); assert.doesNotMatch(d.meta,/\$4\.99|posthog/i);
        const mobileApp=d.graph['@graph'].find(n=>n['@type']==='MobileApplication');
        assert.deepEqual(mobileApp.offers,[{'@type':'Offer',name:'Free download',price:'0',priceCurrency:'USD'}]);
        assert.ok(mobileApp.installUrl.endsWith('/id'+app.id));
        const known=new Set(d.graph['@graph'].map(n=>n['@id']));
        assert.ok(mobileApp.publisher['@id']&&known.has(mobileApp.publisher['@id']));
        assert.equal(d.questions.length,12);
        assert.deepEqual(d.questions,d.faq.mainEntity.map(row=>[row.name,row.acceptedAnswer.text]));
        assert.ok(d.questions.every(row=>!/\$4\.99/.test(row[1])||/regular U\.S\. price/.test(row[1])));
        assert.doesNotMatch(JSON.stringify(d.faq),/PostHog|COPPA|£4\.99/);
        assert.equal(d.overflow,false);
        assert.equal(d.price[0],'Free');
        if(period){
          assert.ok(d.text.startsWith(period+':')&&d.text.includes('U.S. App Store')&&d.text.includes('vary by storefront'));
          assert.equal(d.promoLink,d.links[0]);
          assert.equal(d.promoNote,1); assert.equal(d.styles,1);
          assert.equal(d.price[1],'$4.99 '+(period==='Black Friday'?app.bf:'$1.99 once'));
        } else {
          assert.equal(d.text,null); assert.equal(d.price[1],'$4.99 once');
          assert.equal(d.promoNote,0); assert.equal(d.styles,0);
        }
        loads++;
      }
      // Scroll each real lazy-loaded asset into view; wait for decode and actual reveal.
      // The handoff draft's fixed 60ms incremental scroll + 500ms sleep could miss all 23 reveals.
      const roster=pg.locator('#shelf li');
      assert.equal(await roster.count(),app.count);
      for(let i=0;i<app.count;i++){
        await roster.nth(i).scrollIntoViewIfNeeded();
        await pg.waitForFunction(i=>{
          const tile=document.querySelectorAll('#shelf li')[i],img=tile.querySelector('img');
          return tile.classList.contains('in')&&img.complete&&img.naturalWidth>0;
        },i,{timeout:5000});
        tiles++;
      }
      assert.deepEqual(s.missing,[]);
      assert.equal(hasTracker(s.requests,'posthog.com'),false);
      await s.c.close();
      for(const [width,height] of [[375,812],[812,375],[768,1024],[1440,900]]) for(const theme of ['light','dark']){
        const m=await session(b,{viewport:{width,height},timezoneId:'America/Los_Angeles',locale:'en-US'});
        const p=await m.c.newPage();
        await p.clock.setFixedTime(new Date('2026-11-27T04:00:00Z'));
        await p.goto(origin+app.route,{waitUntil:'domcontentloaded'});
        await p.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme);
        const d=await read(p);
        assert.equal(d.overflow,false,app.route+' '+width+'x'+height+' '+theme);
        assert.ok(d.text&&d.promoLink===d.links[0]);
        assert.notEqual(d.faqBackground,'rgba(0, 0, 0, 0)');
        const toggle=p.locator('#faq summary').first();
        await toggle.click();
        assert.ok(await p.locator('#faq details[open]').count());
        await toggle.click();
        assert.equal(await p.locator('#faq details[open]').count(),0);
        assert.deepEqual(m.missing,[]);
        layouts++;
        await m.c.close();
      }
      const eu=await session(b,{locale:'de-DE',timezoneId:'Europe/Berlin'});
      const e=await eu.c.newPage();
      await e.goto(origin+app.route,{waitUntil:'load'});
      await e.getByRole('button',{name:'Accept'}).waitFor();
      assert.deepEqual(eu.requests,[]);
      await e.getByRole('button',{name:'Accept'}).click();
      await waitRequest(eu.requests,'googletagmanager.com'); await waitRequest(eu.requests,'facebook.net');
      assert.equal(hasTracker(eu.requests,'posthog.com'),false);
      await e.getByRole('button',{name:'Privacy choices'}).click();
      eu.requests.length=0;
      await Promise.all([e.waitForEvent('load'),e.getByRole('button',{name:'Decline'}).click()]);
      assert.deepEqual(eu.requests,[]);
      assert.equal(await e.evaluate(()=>JSON.parse(localStorage.getItem('cp-consent')).status),'denied');
      for(const legal of [app.legal,'/produce/terms.html']){
        await e.goto(origin+legal,{waitUntil:'load'});
        assert.equal(await e.locator('script').count(),0);
        assert.deepEqual(eu.requests,[]);
      }
      consent++;
      await eu.c.close();
      const us=await session(b,{locale:'en-US',timezoneId:'America/Los_Angeles'});
      const u=await us.c.newPage();
      await u.goto(origin+app.route,{waitUntil:'load'});
      await waitRequest(us.requests,'googletagmanager.com'); await waitRequest(us.requests,'facebook.net');
      assert.equal(hasTracker(us.requests,'posthog.com'),false);
      assert.equal(await u.getByRole('button',{name:'Accept'}).count(),0);
      consent++;
      await us.c.close();
      console.log('PASS',app.route,cases.length,'promo/schema boundaries, 8 layout scenarios,',app.count,'decoded roster items, EU/US consent stubs and legal checks');
    }
    assert.match(fs.readFileSync(path.join(root,'robots.txt'),'utf8'),/^User-agent: \*\nAllow: \/\n\nSitemap: https:\/\/claypals\.app\/sitemap\.xml\n$/);
    const sm=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
    assert.deepEqual([...sm.matchAll(/<loc>(.+?)<\/loc>/g)].map(m=>m[1]),['/','/produce/','/privacy.html','/produce/privacy.html','/produce/terms.html'].map(x=>origin+x));
    const llms=fs.readFileSync(path.join(root,'llms.txt'),'utf8');
    assert.doesNotMatch(llms,/posthog|£4\.99/i);
    assert.ok(apps.every(a=>llms.includes('/id'+a.id)));
    console.log('GREEN',loads,'browser boundaries,',layouts,'layout checks,',tiles,'lazy tiles,',consent,'consent route checks, discovery files');
  } finally {await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
