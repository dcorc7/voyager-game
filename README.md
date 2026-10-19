# Voyager

A daily guessing game: an expedition's route is plotted on a globe that you can spin and zoom, and you have to name the explorer. Each wrong guess unlocks one more hint (era, crew size, home country, ship, and so on). You get 6 guesses. The earlier you get it, the more points you score.

Static single-page app: Vite + vanilla JS, with the globe drawn on a `<canvas>` using [d3-geo](https://github.com/d3/d3-geo)'s orthographic projection. No WebGL, no server, and no external image textures (the land outlines come from the `world-atlas` npm package). Progress and stats live in `localStorage`.

## Run It

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # game logic + data validation
npm run check:routes   # flags route segments that cross land
npm run build          # static site in dist/
```

## How a Round Plays

1. The route animates along the globe (the camera follows the ship), then settles on a framing of the whole route. Drag to rotate, scroll or pinch to zoom, arrow keys and +/- also work. Buttons: replay, re-center, zoom.
2. Type a name (the input autocompletes from the explorer list) and press Guess. Unknown names and repeats don't use up an attempt.
3. Wrong guess N unlocks hint N. After the 5th wrong guess you get one last attempt with all hints visible.
4. When the game ends, every hint is shown, place names appear on the globe, and you get a Wordle-style share card.

Scoring (edit `GUESS_SCORES` in `src/game.js`): 100 / 80 / 60 / 40 / 25 / 10 for a correct guess on attempt 1 to 6, 0 if you run out.

One explorer per day. The pool is shuffled once per cycle (a block of as many days as there are explorers), so nobody repeats until everyone has had a turn. Everyone sees the same explorer on the same date. After finishing, there's a practice mode that picks a random explorer without touching your streak.

## Files

- `src/game.js`: pure logic (daily pick, guess matching, hint unlocking, scoring, share text, stats).
- `src/globe.js`: the interactive canvas globe.
- `src/main.js`: UI (hints, guess input, results).
- `data/explorers.json`: the puzzle data.
- `scripts/check_routes.mjs`: route sanity checker.

## Adding an explorer

Append an object to `data/explorers.json`:

```json
{
  "id": "unique-id",
  "name": "Display Name",
  "aliases": ["Other accepted spellings"],
  "years": "1519–1522",
  "summary": "One line shown after the game.",
  "link": "https://en.wikipedia.org/wiki/...",
  "hints": [
    { "label": "Era", "text": "..." },
    { "label": "Crew", "text": "..." },
    { "label": "Origin", "text": "..." },
    { "label": "Vessel", "text": "..." },
    { "label": "Trivia", "text": "..." }
  ],
  "route": [
    { "name": "Port of departure", "lat": 36.78, "lon": -6.35 },
    { "name": null, "lat": 28.0, "lon": -20.0 }
  ]
}
```

Guidelines:

- Exactly 5 hints, ordered vague to specific. Hint text must not contain the explorer's name (a test checks this).
- Each wrong guess shows one hint, so make the early ones genuinely ambiguous and the last one nearly a giveaway.
- Waypoints are `lat`/`lon` in degrees, in travel order. `name: null` means the point is drawn but not labelled (use it for open-sea shaping points). Names are only shown after the game ends, so they can't give the answer away.
- Segments are drawn as great-circle arcs between waypoints, so add waypoints to keep ships at sea: around capes, through straits, along coasts.
- `npm run check:routes` samples each segment against the land mask and lists those that are mostly on land. Fix them by adding offshore waypoints. Set `"inland": true` on a waypoint to say the segment arriving at it is legitimately overland, along a river, or through water too narrow for the coarse 110m map.

## Data Caveat

The sample expeditions (Columbus, Magellan, Cook, da Gama, Amundsen, Shackleton, Zheng He, Leif Erikson) are written from general knowledge. Waypoints are simplified approximations of the real routes, and some figures are estimates that vary by source: crew sizes, and the exact positions for the Norse voyage (the sagas don't give coordinates). Verify facts and refine routes against solid sources before publishing.

## Ideas for Next Steps

- A guess-feedback row after each wrong guess (same century? same country? same ocean?).
- Per-hint score decay instead of per-attempt, or a bonus for guessing before zooming.
- A hard mode that hides the graticule or draws the route without the animation.
- A bigger dataset: add explorers in batches and keep running the tests and the route checker.
- Optional leaderboards: Supabase or a small FastAPI service receiving the daily score.

## Deploy

`npm run build`, then upload `dist/` to Vercel, Netlify, Cloudflare Pages or GitHub Pages. If it's served from a sub-path, set `base` in a `vite.config.js`.
