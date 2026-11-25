/* BFCM 2026, U.S. App Store display prices. Inert after 2026-12-07T04:00Z. */
(() => {
  "use strict";

  const windows = [
    { kind: "Black Friday", start: Date.parse("2026-11-27T04:00:00Z"), end: Date.parse("2026-11-29T04:00:00Z"), until: "Sat Nov 28, 8 PM PT" },
    { kind: "Cyber Monday", start: Date.parse("2026-11-29T04:00:00Z"), end: Date.parse("2026-12-07T04:00:00Z"), until: "Sun Dec 6, 8 PM PT" },
  ];
  const products = {
    "6794948298": { name: "23 ClayPals Toddler Puzzles animals", prices: ["$0.99", "$1.99"], discounts: [80, 60] },
    "6798962112": { name: "28 ClayPals Fruits & Veggies foods", prices: ["Free", "$1.99"], discounts: [null, 60] },
  };

  function activeOffer(product, now) {
    const index = windows.findIndex(({ start, end }) => now >= start && now < end);
    if (index < 0 || !Object.hasOwn(products, product)) return null;
    const { name, prices, discounts } = products[product];
    return { ...windows[index], name, price: prices[index], discount: discounts[index] };
  }

  function render(now) {
    const storeLink = document.querySelector('a[data-cta="hero"]');
    if (!storeLink) return;
    const storeUrl = new URL(storeLink.href);
    const product = storeUrl.pathname.match(/\/id(\d+)$/)?.[1];
    if (storeUrl.origin !== "https://apps.apple.com" || !storeUrl.pathname.startsWith("/us/")) return;
    const offer = activeOffer(product, now);
    if (!offer) return;

    const amounts = [...document.querySelectorAll(".price-split .amount")]
      .filter((node) => node.textContent.trim() === "$4.99 once");
    if (amounts.length !== 1) return;
    const [amount] = amounts;

    const banner = document.createElement("aside");
    banner.className = "cp-bfcm";
    banner.setAttribute("aria-label", "Limited-time U.S. App Store offer");
    const copy = document.createElement("p");
    const intro = document.createElement("strong");
    intro.textContent = `${offer.kind}: `;
    const bargain = offer.price === "Free" ? "for $0" : `for ${offer.price} (${offer.discount}% off)`;
    copy.append(intro, `Unlock all ${offer.name} ${bargain} in the U.S. App Store until ${offer.until}. `);
    copy.append("One-time in-app unlock. Prices and timing vary by storefront; check the price shown in the app.");
    const link = document.createElement("a");
    link.href = storeUrl.href;
    link.textContent = "Get it on the App Store";
    banner.append(copy, link);

    const style = document.createElement("style");
    style.dataset.cpBfcm = "";
    style.textContent = `
      .cp-bfcm{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:.35rem 1rem;padding:.7rem max(var(--gutter,20px),12px);text-align:center;background:var(--bg-sunk);color:var(--ink);border-bottom:1px solid var(--rim);font-size:.95rem}
      .cp-bfcm p,.price-split p.cp-bfcm-note{margin:0}
      .cp-bfcm a{color:inherit;font-weight:600;text-decoration:underline;text-underline-offset:.15em}
      .price-split .cp-bfcm-original{color:var(--ink-soft);font-size:.8em}
    `;
    const original = document.createElement("s");
    original.className = "cp-bfcm-original";
    original.textContent = "$4.99";
    original.setAttribute("aria-label", "Regular price $4.99");
    const note = document.createElement("p");
    note.className = "cp-bfcm-note";
    note.textContent = `${offer.kind} U.S. App Store offer until ${offer.until}`;

    document.head.append(style);
    document.body.prepend(banner);
    amount.replaceChildren(original, offer.price === "Free" ? " Free" : ` ${offer.price} once`);
    amount.after(note);
  }

  render(Date.now());
})();
