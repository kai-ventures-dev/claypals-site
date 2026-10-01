/* =====================================================================
   ClayPals — consent layer (assets/js/consent.js)
   One shared, synchronous, dependency-free script for every marketing
   page. Loaded in <head>, before anything that could set a cookie.

   Ported from standbybooth.com's assets/consent.js so the two sites behave
   the same way; differences are ClayPals' own tag IDs, no PostHog (this
   site never had it), no hand-written _fbc cookie (Meta's pixel already
   sets _fbc from ?fbclid= itself — measured 2026-10-01), and the banner is
   drawn with this site's tokens and voice.

   Order of operations:
     1. Google Consent Mode v2 stub + defaults (granted for the world,
        denied for EEA/UK) — set before gtag.js could load.
     2. Stored choice (localStorage "cp-consent", valid 365 days).
        A stored choice ALWAYS beats the geo heuristic.
     3. Geo heuristic — timezone + language region subtags; any
        exception fails closed (treated as EEA/UK).
     4. Decision: load trackers, show the banner, or do nothing.

   Trackers NEVER load on the privacy or terms pages — any geo, any choice.
   (Those pages do not include this file at all; the guard is a backstop.)
   Public API: window.cpConsent = { grant, deny, reset, status }.
   ===================================================================== */
(function () {

  /* The 27 EU member states + IS/LI/NO (EEA) + GB (UK GDPR). */
  var EEA_UK = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
                'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
                'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
                'GB'];

  /* -----------------------------------------------------------------
     1. Consent Mode v2 stub — FIRST, so defaults precede everything.
     ----------------------------------------------------------------- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  /* Default for the world: granted. */
  gtag('consent', 'default', {
    ad_storage: 'granted',
    analytics_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted'
  });
  /* Regional override for EEA/UK: denied until the visitor accepts. */
  gtag('consent', 'default', {
    ad_storage: 'denied',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    region: EEA_UK,
    wait_for_update: 500
  });

  /* -----------------------------------------------------------------
     2. Stored choice — {v:1, status:'granted'|'denied', ts:ISO}.
     Corrupt, unknown-shape, or >365-day-old records read as "no choice".
     ----------------------------------------------------------------- */
  var STORAGE_KEY = 'cp-consent';
  var MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

  function readChoice() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1) return null;
      if (parsed.status !== 'granted' && parsed.status !== 'denied') return null;
      var ts = Date.parse(parsed.ts);
      if (isNaN(ts) || Date.now() - ts > MAX_AGE_MS) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeChoice(status) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: 1,
        status: status,
        ts: new Date().toISOString()
      }));
    } catch (e) { /* storage blocked — session-only choice */ }
  }

  function clearChoice() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  /* -----------------------------------------------------------------
     3. Geo heuristic — client-side only (GitHub Pages has no server).
     Timezone: any Europe/* zone, plus the five EEA Atlantic zones.
     Language: BCP 47 REGION subtags only ("en-GB" → GB); a bare
     primary subtag ("de") is a language, not a region — never matched.
     Any exception → true (fail closed: when unsure, ask).
     ----------------------------------------------------------------- */
  var EEA_ATLANTIC_TZ = {
    'Atlantic/Reykjavik': 1,
    'Atlantic/Canary': 1,
    'Atlantic/Faroe': 1,
    'Atlantic/Madeira': 1,
    'Atlantic/Azores': 1
  };

  function isEEAUK() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      var tzMatch = tz.indexOf('Europe/') === 0 ||
        Object.prototype.hasOwnProperty.call(EEA_ATLANTIC_TZ, tz);

      var langMatch = false;
      var langs = navigator.languages ||
        (navigator.language ? [navigator.language] : []);
      for (var i = 0; i < langs.length && !langMatch; i++) {
        var parts = String(langs[i]).split('-');
        for (var j = 1; j < parts.length; j++) {
          /* A two-letter subtag after the primary subtag is the region. */
          if (/^[A-Za-z]{2}$/.test(parts[j]) &&
              EEA_UK.indexOf(parts[j].toUpperCase()) !== -1) {
            langMatch = true;
            break;
          }
        }
      }
      return tzMatch || langMatch;
    } catch (e) {
      return true;
    }
  }

  /* -----------------------------------------------------------------
     4. Tracker loaders — the exact configs formerly inlined in <head>
     of index.html and produce/index.html. loadAll() is idempotent and
     a hard NO-OP on the legal pages.
     ----------------------------------------------------------------- */
  var loaded = false;

  function isLegalPage() {
    var p = (window.location && window.location.pathname) || '';
    return /\/(privacy|terms)(\.html)?\/?$/.test(p);
  }

  /* Google Analytics 4 (gtag.js) — measurement ID G-KVS5B771EK. */
  function loadGA4() {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=G-KVS5B771EK';
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', 'G-KVS5B771EK');
  }

  /* Meta Pixel — bootstrap snippet verbatim, then init + PageView. The
     App Store ViewContent lives in assets/js/meta-viewcontent.js, which
     guards on `typeof fbq`, so it sends nothing until this has run. */
  function loadMetaPixel() {
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', '1693906458397139');
    window.fbq('track', 'PageView');
  }

  function loadAll() {
    if (loaded) return;
    if (isLegalPage()) return; /* zero trackers on legal pages, all geos */
    loaded = true;
    loadGA4();
    loadMetaPixel();
  }

  /* -----------------------------------------------------------------
     5. Banner — plain DOM, styled from this site's CSS custom
     properties. Accept and Decline carry equal weight; nothing is
     pre-ticked; there is no dismiss-without-choosing "x".
     ----------------------------------------------------------------- */
  var BANNER_ID = 'cp-consent-banner';
  var STYLE_ID = 'cp-consent-style';

  var BANNER_CSS = [
    '.cp-consent{position:fixed;left:0;right:0;bottom:0;z-index:999;background:var(--surface);border-top:1px solid var(--rim);box-shadow:0 -10px 24px -14px var(--cast);padding-bottom:env(safe-area-inset-bottom);}',
    '.cp-consent-inner{width:min(1080px,100% - var(--gutter)*2);margin:0 auto;padding:16px 0;display:flex;align-items:center;justify-content:space-between;gap:24px;}',
    '.cp-consent-copy{min-width:0;}',
    '.cp-consent-hd{font-family:"Baloo 2",ui-rounded,system-ui,sans-serif;font-weight:800;font-size:1.05rem;line-height:1.25;color:var(--ink);margin:0 0 2px;}',
    '.cp-consent-body{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:.88rem;line-height:1.5;color:var(--ink-body);margin:0;}',
    '.cp-consent-body a{color:var(--terra-press);font-weight:600;}',
    '.cp-consent-actions{display:flex;gap:10px;flex-shrink:0;}',
    '.cp-consent-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 1.4em;font-family:"Baloo 2",ui-rounded,system-ui,sans-serif;font-size:1rem;font-weight:800;line-height:1;color:var(--ink);background:transparent;border:2px solid var(--ink);border-radius:999px;cursor:pointer;transition:background-color .16s ease,color .16s ease;}',
    '.cp-consent-btn:hover{background:var(--ink);color:var(--surface);}',
    '.cp-consent-btn:focus-visible{outline:3px solid var(--terra);outline-offset:3px;}',
    /* Narrow screens: stack, and drop the heading (the body says the same thing),
       so the banner stays short enough to leave the hero's Download button
       uncovered on a 375x667 iPhone SE. */
    '@media (max-width:640px){.cp-consent-inner{flex-direction:column;align-items:stretch;gap:10px;padding:12px 0;}.cp-consent-hd{display:none;}.cp-consent-body{font-size:.84rem;line-height:1.45;}.cp-consent-actions .cp-consent-btn{flex:1;}}'
  ].join('\n');

  function removeBanner() {
    var el = document.getElementById(BANNER_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* The policy that describes THIS page's website analytics. */
  function policyHref() {
    var p = (window.location && window.location.pathname) || '';
    return (p.indexOf('/produce/') === 0 ? '/produce/privacy.html' : '/privacy.html') + '#website';
  }

  function showBanner() {
    if (document.getElementById(BANNER_ID) || !document.body) return;

    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = BANNER_CSS;
      document.head.appendChild(style);
    }

    var banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.className = 'cp-consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie choices');

    var inner = document.createElement('div');
    inner.className = 'cp-consent-inner';

    var copy = document.createElement('div');
    copy.className = 'cp-consent-copy';

    var hd = document.createElement('p');
    hd.className = 'cp-consent-hd';
    hd.textContent = 'Cookies on this website';
    copy.appendChild(hd);

    var body = document.createElement('p');
    body.className = 'cp-consent-body';
    body.appendChild(document.createTextNode(
      "We'd like to count visits and measure our ads. Nothing loads unless you accept, and none of it is in the apps. More in the "
    ));
    var link = document.createElement('a');
    link.href = policyHref();
    link.textContent = 'privacy policy';
    body.appendChild(link);
    body.appendChild(document.createTextNode('.'));
    copy.appendChild(body);

    var actions = document.createElement('div');
    actions.className = 'cp-consent-actions';

    var accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'cp-consent-btn';
    accept.textContent = 'Accept';
    accept.addEventListener('click', function () { api.grant(); });

    var decline = document.createElement('button');
    decline.type = 'button';
    decline.className = 'cp-consent-btn';
    decline.textContent = 'Decline';
    decline.addEventListener('click', function () { api.deny(); });

    actions.appendChild(accept);
    actions.appendChild(decline);

    inner.appendChild(copy);
    inner.appendChild(actions);
    banner.appendChild(inner);
    document.body.appendChild(banner);
  }

  function showBannerWhenReady() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBanner);
    } else {
      showBanner();
    }
  }

  /* -----------------------------------------------------------------
     6. Best-effort cleanup on deny — expire _ga* / _fbp / _fbc cookies
     across domain + path variants.
     ----------------------------------------------------------------- */
  function expireCookie(name, domain) {
    var base = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/';
    document.cookie = domain ? base + '; domain=' + domain : base;
  }

  function clearTrackingCookies() {
    try {
      var host = window.location.hostname;
      var domains = [null, host, '.' + host];
      var parts = host.split('.');
      if (parts.length > 2) {
        var root = parts.slice(-2).join('.');
        domains.push(root, '.' + root);
      }
      var cookies = document.cookie ? document.cookie.split(';') : [];
      for (var i = 0; i < cookies.length; i++) {
        var name = cookies[i].split('=')[0].replace(/^\s+|\s+$/g, '');
        if (name.indexOf('_ga') === 0 || name.indexOf('_fbp') === 0 ||
            name.indexOf('_fbc') === 0) {
          for (var d = 0; d < domains.length; d++) expireCookie(name, domains[d]);
        }
      }
    } catch (e) {}
  }

  /* -----------------------------------------------------------------
     7. Public API — powers the banner buttons and the footer
     "Privacy choices" button on every page.
     ----------------------------------------------------------------- */
  var api = {
    grant: function () {
      writeChoice('granted');
      gtag('consent', 'update', {
        ad_storage: 'granted',
        analytics_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted'
      });
      loadAll();
      removeBanner();
    },
    deny: function () {
      writeChoice('denied');
      /* If anything already loaded this session, tell Google to stop. */
      gtag('consent', 'update', {
        ad_storage: 'denied',
        analytics_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied'
      });
      /* And Meta: a pixel that already loaded keeps running for the rest of
         this page view unless told to stop. */
      if (typeof window.fbq === 'function') window.fbq('consent', 'revoke');
      clearTrackingCookies();
      removeBanner();
    },
    reset: function () {
      clearChoice();
      showBannerWhenReady(); /* any geo — footer "Privacy choices" */
    },
    status: function () {
      var choice = readChoice();
      return choice ? choice.status : null;
    }
  };
  window.cpConsent = api;

  /* -----------------------------------------------------------------
     8. Decision matrix (stored choice always beats geo):
        — stored denied            → nothing loads, no banner
        — stored granted           → consent update + loadAll()
        — no choice, not EEA/UK    → loadAll() immediately, no banner
        — no choice, EEA/UK        → load NOTHING, banner on ready
     ----------------------------------------------------------------- */
  var choice = readChoice();
  if (choice && choice.status === 'denied') {
    /* Respect the denial everywhere. */
  } else if (choice && choice.status === 'granted') {
    gtag('consent', 'update', {
      ad_storage: 'granted',
      analytics_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted'
    });
    loadAll();
  } else if (isEEAUK()) {
    showBannerWhenReady();
  } else {
    loadAll();
  }

})();
