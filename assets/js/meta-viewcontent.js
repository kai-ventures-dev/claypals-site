/* Outbound App Store clicks -> Meta ViewContent (with value, currency and the
   app id) + GA4 app_store_click.

   ONE file for every page on claypals.app that links to the App Store. It
   replaced an identical inline handler on index.html and produce/index.html
   that sent ViewContent with no parameters at all, so Meta could neither value
   the event nor tell the two apps apart.

   Delegated on document, capture phase, so every link to apps.apple.com is
   covered, including any added later. Both tags are optional at runtime: if an
   ad blocker stopped gtag.js or fbevents.js from loading, the typeof guards keep
   the click working normally instead of throwing on a missing global. */

// Promotional pricing ends 9 Oct 2026. After PROMO_ENDS the standard price is
// used automatically — no redeploy needed.
// CONFIRMED by the owner: promo is valid THROUGH 9 Oct; standard pricing from
// 10 Oct. Set to 10 Oct 00:00 UTC. Do not change these numbers — if the App
// Store shows something different, ask rather than editing.
// 2026-10-01: the owner corrected the ClayPals standard price to 4.99 (the
// marketing brief said 3.99). Promo stays 1.99, which the App Store shows.
var PROMO_ENDS = Date.UTC(2026, 9, 10, 0, 0, 0);   // month is 0-indexed: 9 = October

var PRICING = {
  '6794948298': { name: 'ClayPals: Toddler Puzzles',  promo: 1.99,  standard: 4.99  },
  '6798962112': { name: 'ClayPals: Fruits & Veggies', promo: 1.99,  standard: 4.99  },
  '6761357439': { name: 'Standby Booth',              promo: 14.99, standard: 29.99 }
};

function appInfo(id) {
  var p = PRICING[id];
  if (!p) return null;
  return { name: p.name, value: Date.now() < PROMO_ENDS ? p.promo : p.standard };
}

(function () {
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href*="apps.apple.com"]');
    if (!a) return;
    var where = a.getAttribute('data-cta') || 'other';

    var m   = a.href.match(/\/id(\d+)/);
    var id  = m ? m[1] : null;
    var app = (id && appInfo(id)) || { name: 'ClayPals', value: null };

    var eventId = 'vc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);

    if (typeof fbq === 'function') {
      var params = {
        content_ids:  id ? [id] : undefined,
        content_name: app.name,
        content_type: 'product'
      };
      /* value and currency travel together or not at all: a currency with no
         number is exactly the malformed event this file exists to stop. Every
         App Store link on the site today carries a known id, so this only
         matters for a link added later with an id missing from PRICING. */
      if (typeof app.value === 'number') {
        params.value    = app.value;
        params.currency = 'USD';
      }
      fbq('track', 'ViewContent', params, { eventID: eventId });
    }
    window.__lastViewContentEventId = eventId;

    if (typeof gtag === 'function') {
      /* transport_type 'beacon' matters here: these links navigate in the same
         tab, so a plain request can be cancelled as the page unloads. A beacon
         is handed to the browser to deliver after we are gone. */
      gtag('event', 'app_store_click', {
        'event_category': 'outbound',
        'event_label': where,
        'transport_type': 'beacon'
      });
    }
  }, true);
})();
