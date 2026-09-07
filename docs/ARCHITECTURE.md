# How this works

A from-scratch walkthrough of the system, for whoever picks this up next
(including future-you). If you just need the quick reference, see the
root [README.md](../README.md) instead — this doc explains *why* it's built
this way.

## The shape of it

Three pieces, none of which know about the others' internals:

```
 ~/git/island-creek-hoa (private, local-only)      island-creek-hoa-app (public, on GitHub)
 ┌─────────────────────────────┐                    ┌──────────────────────────────┐
 │ Dare County WFS (parcel/    │                    │ index.html, roll-call.html   │
 │ owner data) --fetch-->      │                    │ css/, js/ (generic app code, │
 │ sources/*.json --build-->   │                    │ no real names/addresses in   │
 │ data/directory.json         │                    │ the repo or its history)     │
 └──────────────┬──────────────┘                    └──────────────┬───────────────┘
                │                                                   │
                │ scripts/seed_roster.py                            │ served as static
                │ (run by hand, whenever                            │ files by
                │ ownership data changes)                           │ GitHub Pages
                ▼                                                   ▼
        ┌──────────────────────────────────────────────────────────────┐
        │                    Firestore (Google Cloud)                  │
        │  roster/{lot}      -- 16 docs, one per house                 │
        │  meetings/{date}   -- one doc per calendar day's roll call   │
        └──────────────────────────────────────────────────────────────┘
                                       ▲
                                       │ read (both collections) +
                                       │ write (meetings only, live)
                                       │ straight from the browser,
                                       │ no server in between
                              anyone with the site URL
```

**Why split it this way:** the *private* repo (`island-creek-hoa`) is where
real owner names and addresses live, because it's never pushed anywhere
public. The *public* repo (`island-creek-hoa-app`) is what GitHub Pages
serves, and GitHub Pages' free tier requires a public repo — so that repo
is written to contain nothing sensitive, ever, even in old commits. The
bridge between them is Firestore: a database that isn't tied to either
repo's git history, so it can hold real data without that data becoming
part of a public, permanent, hard-to-scrub commit log.

## Request flow, end to end

**Loading `index.html` (the directory):**
1. Browser requests the static files from GitHub Pages (HTML/CSS/JS, no
   server-side rendering — it's exactly the files in the repo).
2. `js/config.js` sets `window.__FIREBASE_CONFIG__` (the project's public
   identifier — see "Is the API key a secret?" below).
3. `js/firebase-init.js` calls `initializeApp()` and `getFirestore()`,
   exporting a `db` handle other scripts import.
4. `js/directory.js` runs one `getDocs()` query against the `roster`
   collection, ordered by the `order` field, and renders a plain HTML table.
   No live updates here — the directory is read-once, since owner data
   doesn't change mid-session.

**Loading `roll-call.html` (the live attendance sheet):**
1. Same bootstrap as above (config → init → `db`).
2. `js/roll-call.js` computes today's date from `new Date()` (the device's
   own clock — nothing server-side decides what day it is), formats it as
   `YYYY-MM-DD` for the Firestore document ID, and displays a human-readable
   version.
3. It fetches `roster` once (same as the directory) to know which 16 rows
   to draw and in what order.
4. It opens a **live listener** (`onSnapshot`) on `meetings/{today}`. This
   is the core trick: Firestore pushes every change to that document, from
   *any* browser tab anywhere, to every other tab with the same listener
   open — typically within about a second. There's no polling, no refresh
   button, no custom server code making this happen; it's a feature of the
   Firestore client SDK talking directly to Google's backend.
5. Checking a box calls `setDoc(meetingRef, { checked: { [address]: bool
   } }, { merge: true })`. The dotted-path-via-nested-object form with
   `merge: true` updates just that one address's entry inside the `checked`
   map — it does not clobber everyone else's check-ins, and it creates the
   document on the very first check-in of the day if it doesn't exist yet.
6. Every open tab's `onSnapshot` callback fires with the new document state
   and re-renders: tally, quorum met/not-met, which rows are checked. This
   includes the tab that made the change — there's no separate "update my
   own UI" code path, which is deliberate: it means what you see on screen
   is always literally what's in the database, not an optimistic guess that
   could drift.

## The Firestore data model

**`roster/{slug}`** — one document per lot, `slug` derived from the address
(`"39222 Island Creek Ct"` → `39222-island-creek-ct`). Fields:
- `address` (string) — display form, e.g. `"39222 Island Creek Ct"`
- `owner` (string) — from the county tax record, e.g. `"Campbell, Todd
  Charles & Kelley, D'Arcy Kathalene"`
- `house` (string or null) — the short-term-rental name, where matched
- `order` (integer) — north-to-south sort index, 0-15

This collection is **not written from either page in the app.** It's
populated by `scripts/seed_roster.py`, run by hand from a machine that has
the private `island-creek-hoa` repo checked out. That script reads
`data/directory.json` there and overwrites all 16 `roster` docs. Re-run it
whenever ownership changes, a PM match is corrected, etc. — it's fully
idempotent (same input always produces the same 16 docs).

**`meetings/{YYYY-MM-DD}`** — one document per calendar day anyone opens
the roll-call page. Fields:
- `checked` (map, address string → boolean) — who's present. Absent key =
  not yet checked (same as `false`, but no write has happened for that
  address yet today).
- `quorum` (integer) — how many present lots count as quorum for that
  meeting. Editable live from the page, shared the same way attendance is:
  if one board member changes it, everyone's page updates.

Nothing else. No history of who checked whom in, no timestamps per
check-in, no user identity attached to a change (there's no login system
yet — see "What's missing" below). If you need "who marked 39222 present
and when," that's not captured today.

## Why the app code has zero hardcoded data

The whole point of `js/directory.js` and `js/roll-call.js` fetching from Firestore instead of a
JSON file baked into the repo is that **the public repo's git history is
permanent.** Even if you later delete a file with real names in it, anyone
who cloned the repo before that keeps a full copy, and GitHub's own history
view still shows it unless you rewrite history (which doesn't help once
something's been cloned or cached). Firestore data has no such property —
it can be corrected, deleted, or restricted without leaving a public trace
in a repository. That's the entire reason for the two-repo split described
above, and it's worth preserving as a habit: **new features should keep
reading real data from Firestore, never from a constant baked into a
committed file in this repo.**

## Is the Firebase config (the "API key") a secret?

No — and this tripped GitHub's automated secret scanner once already (see
git history). Firebase's web app config (`apiKey`, `authDomain`,
`projectId`, etc. in `js/config.js`) identifies *which* Firebase project a
client SDK should talk to. It is designed by Google to be shipped in public
client-side code — every Firebase web app on the internet has one visible
in its JS bundle. **What actually controls access is `firestore.rules`.**
Committing the config is correct and intentional; don't try to hide it
behind an environment variable or a build step, and don't panic if a
scanner flags it again — just resolve the alert with an explanation, the
way alert #1 was resolved.

## Current security posture (and the auth plan)

Right now, `firestore.rules` allows anyone who can reach `firestore.googleapis.com`
with this project's ID to read and write **both** `roster` and `meetings` —
there is no login, no per-user identity, no distinction between "the person
running this meeting" and "anyone who found the URL." That's acceptable
today because:
- the site URL isn't linked from anywhere public or search-indexed
- the person with practical authority over this data (the operator) is
  also the only person currently using the tool
- the data itself is low-stakes (county-public ownership info + informal
  meeting attendance, not financial or legally binding records)

**This changes once more than one real person uses the tool, or the URL
circulates beyond the HOA board.** The planned fix, when that happens:

1. Add Firebase Authentication (email/password or Google sign-in — either
   works with zero extra backend code, same as everything else here).
2. Maintain a small allowlist of authorized emails/UIDs (a new Firestore
   collection, e.g. `admins/{uid}`, or a Firebase custom claim).
3. Change `firestore.rules` so:
   - `roster` writes require the requester's UID to be in the allowlist
     (currently the seed script bypasses rules entirely by having them
     open — once locked down, the seed script will need to authenticate
     too, e.g. via a Firebase Admin SDK service account run only locally,
     never committed).
   - `meetings` writes require *any* authenticated user (or also the
     allowlist, if attendance-taking should be restricted to board
     members specifically rather than all owners).
4. Add a sign-in screen/button to both pages using the Firebase Auth JS
   SDK (same CDN-import pattern already used for Firestore).

None of this is built yet. It's deliberately deferred — building an auth
system for a single-operator tool would have been solving a problem that
doesn't exist yet, per the same reasoning that kept the rest of this
project scoped to what was actually asked for.

## What's missing / known limitations

- **No auth** (see above) — the biggest one, tracked deliberately.
- **No history.** `meetings/{date}` only ever holds the *current* state for
  that day. If you need "how attendance changed over the course of the
  meeting" or an audit trail, that's not captured — every write overwrites
  the previous value for that address.
- **No offline support.** If a device loses connectivity mid-meeting, its
  checkboxes won't update (Firestore's SDK does have offline-persistence
  options, but they're not enabled here).
- **The directory page doesn't live-update.** If the roster changes while
  someone has `index.html` open, they won't see it until they reload. This
  was a deliberate simplification (owner data doesn't change during a
  session the way attendance does) — revisit if that assumption stops
  holding.
- **`scripts/seed_roster.py` requires local access to the private
  `island-creek-hoa` repo.** There's no way to update the roster from a
  machine that only has this (`island-creek-hoa-app`) repo checked out.
