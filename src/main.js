import { createGlobe } from "./globe.js";
import { h, store, safeUrl } from "./util.js";
import {
  MAX_GUESSES,
  HINT_COUNT,
  dateKey,
  pickDaily,
  newState,
  submitGuess,
  hintsRevealed,
  shareText,
  updateStats,
} from "./game.js";

const $ = (sel) => document.querySelector(sel);

let explorers = [];
let byId = new Map();
let globe = null;
let session = null; // { answer, daily, key, state }
let dailyArgs = null;
let lastHintCount = 0;



// ----------------------------
// ----------- MAIN -----------
// ----------------------------

async function main() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}explorers.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    explorers = await res.json();
    if (!Array.isArray(explorers) || explorers.length < 2) throw new Error("need at least 2 explorers");
  } catch (err) {
    $("#play").replaceChildren(h("p", {}, `Could not load explorers.json (${err.message}).`));
    return;
  }
  byId = new Map(explorers.map((e) => [e.id, e]));

  globe = createGlobe($("#globe"));
  $("#btn-replay").addEventListener("click", () => globe.replay());
  $("#btn-center").addEventListener("click", () => globe.recenter());
  $("#btn-zin").addEventListener("click", () => globe.zoomBy(1.4));
  $("#btn-zout").addEventListener("click", () => globe.zoomBy(1 / 1.4));

  const key = dateKey();
  dailyArgs = { answer: pickDaily(explorers, key), daily: true, key };
  startSession(dailyArgs);
}



// -----------------------------
// ---------- SESSION ----------
// -----------------------------

function loadState(key) {
  const saved = store.get(`omx:day:${key}`, null);
  const ok =
    saved &&
    Array.isArray(saved.guesses) &&
    saved.guesses.every((id) => byId.has(id)) &&
    ["playing", "won", "lost"].includes(saved.status);
  return ok ? { guesses: saved.guesses, status: saved.status } : newState();
}

function startSession(args) {
  const state = args.daily ? loadState(args.key) : newState();
  session = { ...args, state };
  lastHintCount = hintsRevealed(state, args.answer.id);
  globe.setRoute(args.answer.route);
  if (state.status !== "playing") globe.finish();
  renderAll();
}

function onGuess(text) {
  const { state, error } = submitGuess(session.state, explorers, session.answer, text);
  if (error) return showError(error);
  session.state = state;
  if (session.daily) store.set(`omx:day:${session.key}`, state);
  if (state.status !== "playing") finishGame();
  renderAll();
}

function finishGame() {
  globe.finish();
  if (session.daily) {
    const stats = updateStats(store.get("omx:stats", {}), session.key, {
      won: session.state.status === "won",
      guesses: session.state.guesses.length,
    });
    store.set("omx:stats", stats);
  }
}



// -----------------------------
// ---------- RENDERING --------
// -----------------------------

function renderAll() {
  const { state, answer, daily, key } = session;
  const playing = state.status === "playing";
  $("#status").textContent = daily
    ? `Daily · ${key}${playing ? ` · guess ${state.guesses.length + 1} of ${MAX_GUESSES}` : ""}`
    : `Practice${playing ? ` · guess ${state.guesses.length + 1} of ${MAX_GUESSES}` : ""}`;

  renderHints();
  renderGuesses();
  if (playing) {
    $("#result").replaceChildren();
    renderPlay();
  } else {
    $("#play").replaceChildren();
    renderResult();
  }
}

function renderHints() {
  const { answer, state } = session;
  const shown = hintsRevealed(state, answer.id);
  const fresh = shown > lastHintCount ? shown : -1; // highlight a hint that just unlocked
  lastHintCount = shown;

  $("#hints").replaceChildren(
    ...answer.hints.slice(0, HINT_COUNT).map((hint, i) =>
      i < shown
        ? h("div", { class: `hint${fresh === i + 1 ? " new" : ""}` }, h("span", { class: "tag" }, hint.label), h("span", {}, hint.text))
        : h("div", { class: "hint locked" }, h("span", { class: "tag" }, `Hint ${i + 1}`), h("span", {}, `🔒 Unlocks after wrong guess ${i + 1}`))
    )
  );
}

function renderGuesses() {
  const { state, answer } = session;
  if (!state.guesses.length) return $("#guesses").replaceChildren();
  $("#guesses").replaceChildren(
    ...state.guesses.map((id, i) => {
      const hit = id === answer.id;
      return h(
        "div",
        { class: `guess ${hit ? "hit" : "miss"}` },
        h("span", { class: "num" }, `${i + 1}.`),
        h("span", { class: "mark" }, hit ? "✓" : "✗"),
        h("span", {}, byId.get(id).name)
      );
    })
  );
}

let errorEl = null;
function showError(msg) {
  if (errorEl) errorEl.textContent = msg;
}

function renderPlay() {
  const input = h("input", {
    type: "text",
    list: "explorer-names",
    placeholder: "Type an explorer's name…",
    autocomplete: "off",
    autocapitalize: "words",
    spellcheck: "false",
    "aria-label": "Explorer name",
  });
  const names = [...explorers].map((e) => e.name).sort((a, b) => a.localeCompare(b));
  const datalist = h("datalist", { id: "explorer-names" }, names.map((n) => h("option", { value: n })));
  errorEl = h("p", { class: "error", role: "alert" });

  const form = h(
    "form",
    { class: "guess-form" },
    input,
    h("button", { type: "submit" }, "Guess")
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value;
    if (!text.trim()) return showError("Type a name first.");
    showError("");
    onGuess(text);
  });

  $("#play").replaceChildren(form, datalist, errorEl);
  if (matchMedia("(pointer: fine)").matches) input.focus();
}

function renderResult() {
  const { state, answer, daily, key } = session;
  const won = state.status === "won";
  const link = answer.link ? safeUrl(answer.link) : null;
  const text = shareText(daily ? key : "practice", state, answer.id);

  const copyBtn = h("button", {}, "Copy result");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied!";
    } catch {
      copyBtn.textContent = "Copy failed: select the text instead";
    }
  });

  const practiceBtn = h("button", { class: "secondary" }, "Practice with a random explorer");
  practiceBtn.addEventListener("click", () => {
    const others = explorers.filter((e) => e.id !== session.answer.id);
    const answerNext = others[Math.floor(Math.random() * others.length)];
    startSession({ answer: answerNext, daily: false, key: null });
  });
  const backBtn = h("button", { class: "secondary" }, "Back to today's puzzle");
  backBtn.addEventListener("click", () => startSession(dailyArgs));

  const stats = daily ? store.get("omx:stats", null) : null;

  $("#result").replaceChildren(
    h("p", { class: "score-big" }, won ? `${answer.name}` : `It was ${answer.name}`),
    h("p", { class: "meta" }, `${answer.years}${answer.summary ? ` · ${answer.summary}` : ""}`),
    link
      ? h("p", { class: "meta" }, h("a", { href: link, target: "_blank", rel: "noopener noreferrer" }, "Read more"))
      : null,
    h("pre", { class: "share" }, text),
    h("div", { class: "row" }, copyBtn, daily ? practiceBtn : backBtn),
    stats ? renderStats(stats) : null
  );
}

function renderStats(stats) {
  const dist = stats.dist || [];
  const max = Math.max(1, ...dist);
  return h(
    "div",
    {},
    h(
      "p",
      { class: "meta" },
      `Played ${stats.played || 0} · Won ${stats.wins || 0} · Streak ${stats.streak || 0} · Best ${stats.best || 0}`
    ),
    h(
      "p",
      { class: "stats-title" },
      `Guess Distribution (1-${MAX_GUESSES})`
    ),
    h(
      "div",
      { class: "dist", "aria-label": "Guess distribution" },
      Array.from({ length: MAX_GUESSES }, (_, i) => {
        const n = dist[i] || 0;
        return h(
          "div",
          {},
          h("span", {}, String(i + 1)),
          h("span", { class: `bar${n ? "" : " zero"}`, style: `width:${Math.max(8, (n / max) * 100)}%` }, String(n))
        );
      })
    ),
    h("p", { class: "meta" }, `A new explorer arrives tomorrow.`)
  );
}

main();
