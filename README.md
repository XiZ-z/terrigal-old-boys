# Terrigal Old Boys — Season 2, 2026 Doubles Tennis Comp

Static site, no build step, no dependencies. Open `index.html` in a browser,
or host the folder as-is on any static host (Netlify, GitHub Pages, etc.).

## Files

- `index.html`, `fixtures.html`, `ladder.html`, `records.html`, `teams.html`, `finals.html`, `rules.html` — the seven pages
- `data.js` — season structure, weekly results, and all scoring/ladder logic
- `nav.js` — injects the shared top nav + footer on every page
- `styles.css` — shared styling

## Weekly workflow: entering results

There's no live data source — this is intentional. Each Wednesday:

1. Club records results on the paper score sheet per court.
2. Photograph the sheets and share them in a chat with Claude.
3. Claude reads the photos and reports the set/game scores per court.
4. Add one line per court to the `RESULTS` object in `data.js`:

```js
"ROUND-COURT": { setsA: X, setsB: Y, gamesA: A, gamesB: B },
```

- `ROUND` is 1–14 (round robin) — see `ALL_ROUNDS` in `data.js` for who's playing who.
- `COURT` is 0–3 (court 1 = index 0, court 4 = index 3).
- `setsA`/`setsB` are out of 6 total, can include `.5` for a drawn (4–4) set.
- `gamesA`/`gamesB` are total games across all 6 sets, and always sum to 48.

The Home, Fixtures, and Ladder pages recompute automatically from `RESULTS` —
nothing else needs updating.

Rounds 15–16 are wet-weather reserve weeks (`RESERVE_DATES` in `data.js`) —
only used if a round robin week is rained out; leave them out of `RESULTS`
unless they're actually played.
