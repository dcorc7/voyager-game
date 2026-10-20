// Pure game logic: no DOM access, so it is easy to test.

export const MAX_GUESSES = 6;
export const HINT_COUNT = 5; // wrong guess N unlocks hint N


// ---------------------------------------
// ---------- SEEDED RANDOMNESS ----------
// ---------------------------------------

export function hashString(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) ^ (h1 >>> 0);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(items, rng) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}



// ---------------------------
// ---------- DATES ----------
// ---------------------------

const pad = (n) => String(n).padStart(2, "0");

/** Local-date key like "2026-10-19". */
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days since the Unix epoch for a "YYYY-MM-DD" key (timezone-proof). */
export function dayNumber(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function shiftDay(key, delta) {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * One explorer per day. The pool is shuffled once per "cycle" (a block of
 * explorers.length days), so nobody repeats until everyone has had a turn.
 */
export function pickDaily(explorers, key) {
  const pool = [...explorers].sort((a, b) => a.id.localeCompare(b.id));
  const n = pool.length;
  const dn = dayNumber(key);
  const cycle = Math.floor(dn / n);
  const order = seededShuffle(pool, mulberry32(hashString(`cycle:${cycle}`)));
  return order[dn - cycle * n];
}


// ------------------------------
// ---------- GUESSING ----------
// ------------------------------

export function normalizeName(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Match typed text against explorer names and aliases (accent/case-insensitive). */
export function findExplorer(explorers, text) {
  const q = normalizeName(text);
  if (!q) return null;
  return (
    explorers.find((e) => [e.name, ...(e.aliases || [])].some((n) => normalizeName(n) === q)) || null
  );
}

export function newState() {
  return { guesses: [], status: "playing" };
}

/** Returns { state, error }. An invalid or repeated guess does not use up an attempt. */
export function submitGuess(state, explorers, answer, text) {
  if (state.status !== "playing") return { state, error: "This game is over." };
  const found = findExplorer(explorers, text);
  if (!found) return { state, error: "Pick an explorer from the list." };
  if (state.guesses.includes(found.id)) return { state, error: "You already guessed that explorer." };
  const guesses = [...state.guesses, found.id];
  const won = found.id === answer.id;
  const status = won ? "won" : guesses.length >= MAX_GUESSES ? "lost" : "playing";
  return { state: { guesses, status }, error: null };
}

export function wrongCount(state, answerId) {
  return state.guesses.filter((id) => id !== answerId).length;
}

/** How many hints are visible. Once the game is over, every hint is shown. */
export function hintsRevealed(state, answerId, total = HINT_COUNT) {
  if (state.status !== "playing") return total;
  return Math.min(wrongCount(state, answerId), total);
}



// -------------------------------------
// ---------- SHARING & STATS ----------
// -------------------------------------

export function shareText(key, state, answerId) {
  const n = state.guesses.length;
  const cells = [];
  for (let i = 0; i < MAX_GUESSES; i++) {
    if (i >= n) cells.push("⬜");
    else cells.push(state.guesses[i] === answerId ? "🟩" : "🟥");
  }
  const result = state.status === "won" ? n : "X";
  return `🗺️ Voyager ${key}\n${result}/${MAX_GUESSES}\n${cells.join("")}`;
}

/** Wordle-style stats: a loss breaks the streak; skipping a day also breaks it. */
export function updateStats(stats, key, { won, guesses }) {
  if (stats && stats.lastPlayed === key) return stats;
  const next = { played: 0, wins: 0, streak: 0, best: 0, ...stats };
  next.dist = Array.from({ length: MAX_GUESSES }, (_, i) => (stats && stats.dist ? stats.dist[i] || 0 : 0));
  next.played += 1;
  if (won) {
    next.wins += 1;
    next.dist[guesses - 1] += 1;
    next.streak = next.lastWon === shiftDay(key, -1) ? next.streak + 1 : 1;
    next.best = Math.max(next.best, next.streak);
    next.lastWon = key;
  } else {
    next.streak = 0;
  }
  next.lastPlayed = key;
  return next;
}
