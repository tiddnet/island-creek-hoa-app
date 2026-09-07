# Island Creek HOA — live tools

Static site (GitHub Pages) + Firestore backend for two Island Creek HOA
tools: a read-only owner directory and a live, multi-device meeting
roll-call/quorum tracker.

This repo intentionally contains **no real owner names, addresses, or
attendance data** — that all lives in Firestore. The app is generic: it
renders whatever's in the `roster` and `meetings` collections. This keeps
the repo safe to make public (required for free GitHub Pages) even though
the data it displays isn't public in the same durable, permanent way a git
history is.

## Layout

```
index.html         Read-only owner/house directory.
roll-call.html      Live, shared meeting attendance + quorum tally.
css/style.css       Shared styling for both pages.
js/config.js        Firebase project config (safe to commit -- see below).
js/firebase-init.js Initializes the Firebase app + Firestore client.
js/directory.js     Loads and renders the roster (index.html).
js/roll-call.js     Loads the roster, then live-syncs today's meeting doc.
firestore.rules     Security rules -- paste into Firebase Console -> Rules.
scripts/seed_roster.py  One-time (or re-run-on-change) roster loader, reads
                     from a LOCAL, PRIVATE file -- never commit real data here.
```

## Data model (Firestore)

- **`roster/{slug}`** — one doc per lot: `address`, `owner`, `house`,
  `order` (north-to-south sort index). Seeded/updated via
  `scripts/seed_roster.py`, not edited from the app.
- **`meetings/{YYYY-MM-DD}`** — one doc per calendar day (device-clock
  date, not editable in the UI): `checked` (map of address -> bool),
  `quorum` (number). Read and written live by `roll-call.html` via
  Firestore's real-time listeners (`onSnapshot`) — every open tab on the
  same day's page sees every other tab's changes within ~1 second, no
  backend code required.

## Is my Firebase config a secret?

No. `js/config.js`'s `apiKey` etc. identify the project to Firebase's client
SDK — they don't grant access on their own (this is explicitly documented
Firebase behavior). **Actual access control is `firestore.rules`.** Don't
add secrets (service account keys, admin credentials) to this repo; there
should never be a reason to.

## Updating the roster

Ownership changes, a new PM match, a correction -- update it in the source
of truth (the private `island-creek-hoa` repo's `data/directory.json`), then
re-run:

```bash
python3 scripts/seed_roster.py --project-id island-creek-hoa \
    --source ~/git/island-creek-hoa/data/directory.json
```

This overwrites all 16 `roster` docs from that file. It does not touch
`meetings`.

## Current security posture (bootstrap phase)

Both `roster` and `meetings` are currently world-read-write in
`firestore.rules` — anyone with the site URL (not indexed, not linked
publicly, but not access-controlled either) could read or edit the data.
That's what makes the live roll-call work with zero backend/auth code today.

**Before this tool has more than one real user, or before its URL is
shared beyond the HOA board:** add Firebase Auth (e.g. email allowlist for
board members) and tighten `firestore.rules` so `meetings` writes require
`request.auth.uid` in that allowlist, and `roster` writes are blocked
entirely (admin-only, via the seed script).

## Local development

Any static file server works (ES modules need `http://`, not `file://`):

```bash
python3 -m http.server 8791
# then open http://localhost:8791/index.html
```

## Deploying

Push to `main` on GitHub with **Settings -> Pages -> Deploy from branch:
main / (root)** enabled. No build step -- it's plain HTML/CSS/JS.
