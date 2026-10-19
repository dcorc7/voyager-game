import test from "node:test";
import assert from "node:assert/strict";
import {
  GUESS_SCORES,
  HINT_COUNT,
  MAX_GUESSES,
  dayNumber,
  findExplorer,
  hintsRevealed,
  newState,
  normalizeName,
  pickDaily,
  scoreFor,
  shareText,
  shiftDay,
  submitGuess,
  updateStats,
} from "./game.js";

const explorers = [
  { id: "a", name: "Ada Árbol", aliases: ["Arbol"] },
  { id: "b", name: "Bea Bruin" },
  { id: "c", name: "Cy Cole" },
  { id: "d", name: "Di Dunn" },
  { id: "e", name: "Ed Enz" },
  { id: "f", name: "Flo Fox" },
  { id: "g", name: "Gus Gray" },
  { id: "h", name: "Hal Hale" },
];
const answer = explorers[0];



// ---------------------------
// ---------- TESTS ----------
// ---------------------------

test("normalizeName ignores case, accents and punctuation", () => {
  assert.equal(normalizeName("  Ada  Árbol! "), "ada arbol");
});

test("findExplorer matches names and aliases only", () => {
  assert.equal(findExplorer(explorers, "ada arbol").id, "a");
  assert.equal(findExplorer(explorers, "ARBOL").id, "a");
  assert.equal(findExplorer(explorers, "Ada"), null);
  assert.equal(findExplorer(explorers, ""), null);
});

test("invalid and repeated guesses do not use up an attempt", () => {
  let s = newState();
  let r = submitGuess(s, explorers, answer, "nobody");
  assert.ok(r.error);
  assert.equal(r.state.guesses.length, 0);
  r = submitGuess(s, explorers, answer, "Bea Bruin");
  s = r.state;
  assert.equal(s.guesses.length, 1);
  r = submitGuess(s, explorers, answer, "Bea Bruin");
  assert.ok(r.error);
  assert.equal(r.state.guesses.length, 1);
});

test("a correct guess wins and scores by attempt number", () => {
  let s = submitGuess(newState(), explorers, answer, "Bea Bruin").state;
  s = submitGuess(s, explorers, answer, "Ada Árbol").state;
  assert.equal(s.status, "won");
  assert.equal(scoreFor(s), GUESS_SCORES[1]);
  assert.ok(submitGuess(s, explorers, answer, "Cy Cole").error);
});

test("running out of guesses loses with zero points", () => {
  let s = newState();
  for (const e of explorers.slice(1, 1 + MAX_GUESSES)) {
    s = submitGuess(s, explorers, answer, e.name).state;
  }
  assert.equal(s.status, "lost");
  assert.equal(scoreFor(s), 0);
});

test("wrong guesses unlock hints one at a time; game over shows all", () => {
  let s = newState();
  assert.equal(hintsRevealed(s, answer.id), 0);
  s = submitGuess(s, explorers, answer, "Bea Bruin").state;
  assert.equal(hintsRevealed(s, answer.id), 1);
  s = submitGuess(s, explorers, answer, "Cy Cole").state;
  assert.equal(hintsRevealed(s, answer.id), 2);
  s = submitGuess(s, explorers, answer, "Ada Árbol").state;
  assert.equal(s.status, "won");
  assert.equal(hintsRevealed(s, answer.id), HINT_COUNT);
});

test("dayNumber and shiftDay agree and handle month/year edges", () => {
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
  assert.equal(dayNumber("2026-10-20") - dayNumber("2026-10-19"), 1);
});

test("pickDaily is deterministic and never repeats within a cycle", () => {
  assert.equal(pickDaily(explorers, "2026-10-19").id, pickDaily(explorers, "2026-10-19").id);
  const n = explorers.length;
  // find the start of a cycle: a day number divisible by n
  const start = Math.ceil(dayNumber("2026-10-19") / n) * n;
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const key = shiftDay("1970-01-01", start + i);
    seen.add(pickDaily(explorers, key).id);
  }
  assert.equal(seen.size, n);
});

test("shareText hides the answer and marks each attempt", () => {
  let s = submitGuess(newState(), explorers, answer, "Bea Bruin").state;
  s = submitGuess(s, explorers, answer, "Ada Árbol").state;
  const text = shareText("2026-10-19", s, answer.id);
  assert.match(text, /2\/6/);
  assert.match(text, /🟥🟩⬜⬜⬜⬜/);
  assert.ok(!text.includes("Ada"));
  const lost = { guesses: ["b", "c", "d", "e", "f", "g"], status: "lost" };
  assert.match(shareText("2026-10-19", lost, "a"), /X\/6/);
});

test("stats: wins build a streak, a loss or a gap resets it", () => {
  let st = updateStats({}, "2026-10-18", { won: true, guesses: 3 });
  assert.equal(st.streak, 1);
  assert.equal(st.dist[2], 1);
  st = updateStats(st, "2026-10-19", { won: true, guesses: 1 });
  assert.equal(st.streak, 2);
  assert.equal(st.best, 2);
  assert.equal(updateStats(st, "2026-10-19", { won: false, guesses: 6 }), st); // same day: ignored
  st = updateStats(st, "2026-10-20", { won: false, guesses: 6 });
  assert.equal(st.streak, 0);
  assert.equal(st.best, 2);
  st = updateStats(st, "2026-10-21", { won: true, guesses: 2 });
  assert.equal(st.streak, 1);
  st = updateStats(st, "2026-10-25", { won: true, guesses: 2 });
  assert.equal(st.streak, 1);
  assert.equal(st.played, 5);
  assert.equal(st.wins, 4);
});
