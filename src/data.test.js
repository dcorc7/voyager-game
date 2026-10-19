import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HINT_COUNT, findExplorer, normalizeName } from "./game.js";

const explorers = JSON.parse(readFileSync(new URL("../data/explorers.json", import.meta.url), "utf8"));

test("there are enough explorers for a rotation", () => {
  assert.ok(explorers.length >= 6);
});

test("ids are unique and names/aliases never collide", () => {
  assert.equal(new Set(explorers.map((e) => e.id)).size, explorers.length);
  const seen = new Map();
  for (const e of explorers) {
    for (const n of [e.name, ...(e.aliases || [])]) {
      const key = normalizeName(n);
      assert.ok(!seen.has(key) || seen.get(key) === e.id, `"${n}" is used by two explorers`);
      seen.set(key, e.id);
    }
    assert.equal(findExplorer(explorers, e.name).id, e.id);
  }
});

test("every explorer has the required fields and exactly HINT_COUNT hints", () => {
  for (const e of explorers) {
    for (const f of ["id", "name", "years", "summary", "link"]) {
      assert.ok(typeof e[f] === "string" && e[f].length > 0, `${e.id}: missing ${f}`);
    }
    assert.equal(e.hints.length, HINT_COUNT, `${e.id}: needs ${HINT_COUNT} hints`);
    for (const hint of e.hints) {
      assert.ok(hint.label && hint.text, `${e.id}: hint needs label and text`);
    }
  }
});

test("hints never contain the explorer's own name", () => {
  for (const e of explorers) {
    const blob = ` ${normalizeName(e.hints.map((h) => h.text).join(" "))} `;
    for (const token of normalizeName(e.name).split(" ").filter((t) => t.length > 3)) {
      assert.ok(!blob.includes(` ${token} `), `${e.id}: hint leaks "${token}"`);
    }
  }
});

test("routes have valid coordinates and enough waypoints", () => {
  for (const e of explorers) {
    assert.ok(e.route.length >= 3, `${e.id}: route too short`);
    for (const p of e.route) {
      assert.ok(Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90, `${e.id}: bad lat ${p.lat}`);
      assert.ok(Number.isFinite(p.lon) && p.lon >= -180 && p.lon <= 180, `${e.id}: bad lon ${p.lon}`);
    }
  }
});

test("links are http(s)", () => {
  for (const e of explorers) assert.match(e.link, /^https?:\/\//);
});
