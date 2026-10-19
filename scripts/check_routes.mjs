// Flags route segments that cross a lot of land, so you can add waypoints at sea.
//
//   npm run check:routes            # report only
//   npm run check:routes -- --strict   # exit 1 if anything is flagged
//
// Each segment is drawn on the globe as a great-circle arc. We sample points along
// it and test them against the land polygons used by the globe (110m resolution,
// so small islands and narrow straits are not represented, and tiny coastal
// clips are expected). A waypoint with "inland": true marks the segment that
// *arrives* at it as intentionally overland, along a river, or through water
// too narrow for the 110m land mask (for example the Strait of Magellan).

import { readFileSync } from "node:fs";
import { geoContains, geoDistance, geoInterpolate } from "d3-geo";
import { feature } from "topojson-client";

const THRESHOLD = 0.4; // flag segments with more than 40% of samples on land
const strict = process.argv.includes("--strict");

const topo = JSON.parse(
  readFileSync(new URL("../node_modules/world-atlas/land-110m.json", import.meta.url), "utf8")
);
const land = feature(topo, topo.objects.land);
const explorers = JSON.parse(readFileSync(new URL("../data/explorers.json", import.meta.url), "utf8"));

let flagged = 0;
for (const e of explorers) {
  const pts = e.route;
  const problems = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = [pts[i].lon, pts[i].lat];
    const b = [pts[i + 1].lon, pts[i + 1].lat];
    if (pts[i + 1].inland) continue;
    const deg = (geoDistance(a, b) * 180) / Math.PI;
    const n = Math.min(400, Math.max(12, Math.ceil(deg / 0.4)));
    const interp = geoInterpolate(a, b);
    let onLand = 0;
    let counted = 0;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (t < 0.08 || t > 0.92) continue; // ports sit on the coast
      counted += 1;
      if (geoContains(land, interp(t))) onLand += 1;
    }
    const frac = counted ? onLand / counted : 0;
    if (frac > THRESHOLD) {
      problems.push(
        `  segment ${i + 1}→${i + 2} (${pts[i].name || `${pts[i].lat},${pts[i].lon}`} → ${
          pts[i + 1].name || `${pts[i + 1].lat},${pts[i + 1].lon}`
        }): ${(frac * 100).toFixed(0)}% on land`
      );
    }
  }
  if (problems.length) {
    flagged += problems.length;
    console.log(`${e.id}:`);
    console.log(problems.join("\n"));
  }
}

console.log(flagged ? `\n${flagged} segment(s) flagged.` : "No segments flagged.");
if (strict && flagged) process.exit(1);
