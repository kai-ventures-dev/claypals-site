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
