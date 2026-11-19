# Consent and tracking checks

`consent.spec.js` drives real Chrome through the cookie banner and the App Store
click tracking on `/` and `/produce/`. Google and Meta *event* requests are
blocked at the network layer, so a run sends nothing to either; Meta's script and
pixel config are still fetched, because the behaviour under test depends on them.

Folders starting with `_` are not published by GitHub Pages (Jekyll), so this
stays out of claypals.app.

```bash
npm i playwright-core            # once, anywhere; uses the installed Google Chrome

# The live site
BASE=https://claypals.app node _tests/consent.spec.js

# This checkout, served AT claypals.app (Meta's automatic click tracking is tied
# to the domain, so a localhost run cannot see it — case K needs this mode)
BASE=https://claypals.app LOCALROOT=$PWD node _tests/consent.spec.js
```

Ends with `GREEN` or `RED: n failure(s)`; exit code 0 or 1.

Recorded red runs: 30 failures against ed99945 (no banner), 16 against 0d0babb
(first banner), 10 against 4f72a0f (Decline click reached Meta).

## Offline suite

`offline.spec.js` serves this checkout at `https://claypals.app` from disk and
answers every Google, Meta and PostHog URL with an empty stub, so a run sends
nothing anywhere. It reads what the page asked each tracker to do from the queues
their bootstrap snippets fill. It covers consent (nothing before Accept in the
EEA/UK, PostHog only after an Accept in every region and only on `/` and
`/produce/`, decline, revoke), the legal pages, the JSON-LD and its match with the
visible FAQ, head tags, links, assets, layout at three widths, and the root files.

```bash
node _tests/offline.spec.js                     # needs playwright-core, as above
SHOTS=/some/folder node _tests/offline.spec.js  # also saves screenshots there
```

It does not run the real gtag.js, fbevents.js or PostHog library, so it cannot
see what they send once loaded (Do Not Track handling, PostHog's own cookies).
`consent.spec.js` still covers Meta's real script; it now blocks posthog.com too.

Recorded red run: 22 failures with the handoff's consent.js as delivered, kept as
`fixtures/consent.handoff-as-delivered.js` (it loads PostHog outside the EEA/UK
with no Accept, on any page that includes it, with autocapture on, and a Decline
followed by an Accept leaves PostHog's opt-out marker in place):

```bash
CONSENT=$PWD/_tests/fixtures/consent.handoff-as-delivered.js node _tests/offline.spec.js
```
