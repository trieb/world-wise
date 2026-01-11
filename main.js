(() => {
  const SHOW_SETTINGS_PANEL = false;
  const $ = (sel) => document.querySelector(sel);
  function normalizeAnswer(s) {
    return (s ?? "")
      .toString()
      .trim()
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[_]/g, " ")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9\s\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function uniqBy(arr, keyFn) {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      const k = keyFn(x);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(x);
      }
    }
    return out;
  }
  function ensureLeadingSlash(path) {
    if (!path) return "";
    return path.startsWith("/") ? path : ("/" + path);
  }
  function bestFlagPath(item) {
    return item.normal_flag || item.small_flag || "";
  }
  // UI
  const elModeName = $("#modeName");
  const elScore = $("#score");
  const elStreak = $("#streak");
  const elProgress = $("#progress");
  const elPrompt = $("#prompt");
  const elResult = $("#result");
  const elDataWarning = $("#dataWarning");
  const btnNext = $("#btnNext");
  const btnSkip = $("#btnSkip");
  const btnReset = $("#btnReset");
  const btnShuffle = $("#btnShuffle");
  const btnToggleSetup = $("#btnToggleSetup");
  const setup = $("#setup");
  const manifestInput = $("#manifestInput");
  const btnUsePasted = $("#btnUsePasted");
  const btnClearLocal = $("#btnClearLocal");
  // State
  const state = {
    items: [], // {country, capital, normal_flag, small_flag}
    score: 0,
    streak: 0,
    progress: 0,
    current: null,
    locked: false,
  };
  const MODES = [
    { id: 1, name: "Flag → Country" },
    { id: 2, name: "Country → Flag (4 choices)" },
    { id: 3, name: "Country → Capital" },
    { id: 4, name: "Capital → Country" },
  ];
  function setHud() {
    elScore.textContent = String(state.score);
    elStreak.textContent = String(state.streak);
    elProgress.textContent = String(state.progress);
  }
  function showResult(ok, msg) {
    elResult.className = "result show " + (ok ? "good" : "bad");
    elResult.textContent = msg;
  }
  function clearResult() {
    elResult.className = "result";
    elResult.textContent = "";
  }
  function toggleSetup() {
    setup.classList.toggle("show");
  }
  // ---- NEW manifest parser (single object) ----
  function parseManifestObject(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    const out = [];
    for (const [country, obj] of Object.entries(data)) {
      if (!country || !obj || typeof obj !== "object") continue;
      const capital = (obj.capital ?? "").toString().trim() || "UnknownCapital";
      const normal_flag = ensureLeadingSlash((obj.normal_flag ?? "").toString().trim());
      const small_flag = ensureLeadingSlash((obj.small_flag ?? "").toString().trim());
      out.push({
        country: country.trim(),
        capital,
        normal_flag,
        small_flag,
      });
    }
    const dedup = uniqBy(out, x => normalizeAnswer(x.country));
    dedup.sort((a,b) => a.country.localeCompare(b.country));
    return dedup;
  }
  async function tryLoadManifest() {
    try {
      const r = await fetch("flags_manifest.json", { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch (_) {}
    const ls = localStorage.getItem("flags_manifest_object_json");
    if (ls) {
      try { return JSON.parse(ls); } catch (_) {}
    }
    return null;
  }
  function setItemsFromManifestObject(data) {
    const items = parseManifestObject(data);
    state.items = items;
    const missing = items.filter(it => !bestFlagPath(it)).length;
    if (items.length && missing) {
      elDataWarning.style.display = "block";
      elDataWarning.textContent = `Warning: ${missing} entries have no flag paths (normal_flag/small_flag missing).`;
    } else {
      elDataWarning.style.display = "none";
      elDataWarning.textContent = "";
    }
    return items.length;
  }
  function usePastedJson() {
    const raw = manifestInput.value.trim();
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      localStorage.setItem("flags_manifest_object_json", JSON.stringify(data));
      const count = setItemsFromManifestObject(data);
      alert(`Loaded ${count} countries from pasted JSON.`);
      resetGame();
    } catch (e) {
      alert("Invalid JSON. Paste the full flags_manifest.json content (single object).");
    }
  }
  function clearLocal() {
    localStorage.removeItem("flags_manifest_object_json");
    alert("Cleared local (browser) manifest. Reload to try flags_manifest.json from the server again.");
  }
  function pickRandomItem(except = null) {
    if (!state.items.length) return null;
    if (state.items.length === 1) return state.items[0];
    let tries = 0;
    while (tries++ < 12) {
      const it = state.items[Math.floor(Math.random() * state.items.length)];
      if (!except) return it;
      if (normalizeAnswer(it.country) !== normalizeAnswer(except.country)) return it;
    }
    return state.items[Math.floor(Math.random() * state.items.length)];
  }
  function pickMode() {
    return MODES[Math.floor(Math.random() * MODES.length)];
  }
  function buildChoices(correctItem, count = 4) {
    const choices = [correctItem];
    while (choices.length < count) {
      const it = pickRandomItem();
      if (!it) break;
      const exists = choices.some(x => normalizeAnswer(x.country) === normalizeAnswer(it.country));
      if (!exists) choices.push(it);
    }
    return shuffle(choices);
  }
  function wireTextSubmit(q, expect) {
    const input = $("#answerInput");
    const btn = $("#btnSubmit");
    const submit = () => {
      if (state.locked) return;
      const user = normalizeAnswer(input.value);
      const correct = normalizeAnswer(expect === "country" ? q.item.country : q.item.capital);
      const ok = user === correct;
      state.locked = true;
      state.progress += 1;
      if (ok) {
        state.score += 1;
        state.streak += 1;
        showResult(true, `✅ Correct! ${q.item.country} — ${q.item.capital}`);
      } else {
        state.streak = 0;
        showResult(false, `❌ Not quite. Correct: ${q.item.country} — ${q.item.capital}`);
      }
      setHud();
    };
    btn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  }
  function wireChoices(q) {
    const wrap = $("#choices");
    wrap.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-idx]");
      if (!btn || state.locked) return;
      const idx = Number(btn.getAttribute("data-idx"));
      const chosen = q.choices[idx];
      const ok = normalizeAnswer(chosen.country) === normalizeAnswer(q.item.country);
      state.locked = true;
      state.progress += 1;
      [...wrap.querySelectorAll("button[data-idx]")].forEach((b) => {
        const j = Number(b.getAttribute("data-idx"));
        const it = q.choices[j];
        const isCorrect = normalizeAnswer(it.country) === normalizeAnswer(q.item.country);
        const isChosen = j === idx;
        b.classList.remove("good", "danger");
        if (isCorrect) {
          b.classList.add("good");
        } else if (isChosen) {
          b.classList.add("danger");
        }
      });
      if (ok) {
        state.score += 1;
        state.streak += 1;
        showResult(true, `✅ Correct! ${q.item.country} (Capital: ${q.item.capital}).`);
      } else {
        state.streak = 0;
        showResult(false, `❌ Nope. Correct flag: ${q.item.country} (Capital: ${q.item.capital}).`);
      }
      setHud();
    });
  }
  function renderQuestion(q) {
    state.locked = false;
    clearResult();
    //elModeName.textContent = q.mode.name;
    const flagPath = bestFlagPath(q.item);
    const normalizedFlagPath = flagPath.replace(/^\//, "");
    const resolvedFlagPath = new URL(normalizedFlagPath, document.baseURI).href;
    if (q.mode.id === 1) {
      elPrompt.innerHTML = `
        <!--<div class=\"modeTag\">1) Given a flag, name the country</div>-->
        <div class=\"flagWrap\">
          <div class=\"flagBox\"><img src=\"${resolvedFlagPath}\" alt=\"Flag\"></div>
          <div style=\"flex:1;min-width:240px;\">
            <div class=\"question\">Which country is this?</div>
            <div class=\"sub\">Type the country name and press <span class=\"kbd\">Enter</span>.</div>
            <div class=\"row\" style=\"margin-top: 10px;\">
              <input id=\"answerInput\" type=\"text\" placeholder=\"Country name…\" autocomplete=\"off\" />
              <button class=\"primary\" id=\"btnSubmit\">Submit</button>
              <button id=\"btnHelp\">Help</button>
            </div>
            <div class=\"hints\" id=\"hintBox\">
              <div class=\"sub\">Pick one:</div>
              <div class=\"hintGrid\" id=\"hintGrid\"></div>
            </div>
            <div class=\"smallNote\" style=\"margin-top:10px;\">Case-insensitive; ignores accents.</div>
          </div>
        </div>
      `;
      wireTextSubmit(q, "country");
      wireHintButton({ type: "country", item: q.item });
    }
    if (q.mode.id === 2) {
      const buttons = q.choices.map((it, idx) => {
        const p = bestFlagPath(it);
        const normalized_p = p.replace(/^\//, "");
        const resolved_p = new URL(normalized_p, document.baseURI).href;
        return `
          <button class=\"choiceBtn\" data-idx=\"${idx}\" title=\"Select this flag\">
            <img src=\"${resolved_p}\" alt=\"flag option\">
          </button>
        `;
      }).join("");
      elPrompt.innerHTML = `
        <!--<div class=\"modeTag\">2) Given a country, select the correct flag</div>-->
        <div class=\"question\">Select the flag for: <span style=\"color:#cdd6ff\">${q.item.country}</span></div>
        <div class=\"sub\">One is correct. Three are decoys.</div>
        <div class=\"choices\" id=\"choices\">${buttons}</div>
      `;
      wireChoices(q);
    }
    if (q.mode.id === 3) {
      elPrompt.innerHTML = `
        <!--<div class=\"modeTag\">3) Given a country, name the capital</div>-->
        <div class=\"question\">What is the capital of <span style=\"color:#cdd6ff\">${q.item.country}</span>?</div>
        <div class=\"sub\">Type the capital and press <span class=\"kbd\">Enter</span>.</div>
        <div class=\"row\" style=\"margin-top: 10px;\">
          <input id=\"answerInput\" type=\"text\" placeholder=\"Country name…\" autocomplete=\"off\" />
          <button class=\"primary\" id=\"btnSubmit\">Submit</button>
          <button id=\"btnHelp\">Help</button>
        </div>
        <div class=\"hints\" id=\"hintBox\">
          <div class=\"sub\">Pick one (but you still must type the answer):</div>
          <div class=\"hintGrid\" id=\"hintGrid\"></div>
        </div>
        <div class=\"smallNote\" style=\"margin-top:10px;\">(Optional hint) The flag is shown below.</div>
        <div class=\"flagBox\" style=\"width:100%;height:120px;margin-top:10px;\">
          <img src=\"${resolvedFlagPath}\" alt=\"Flag\">
        </div>
      `;
      wireTextSubmit(q, "capital");
      wireHintButton({ type: "capital", item: q.item });
    }
    if (q.mode.id === 4) {
      elPrompt.innerHTML = `
        <!--<div class=\"modeTag\">4) Given a capital, name the country</div>-->
        <div class=\"question\">Which country has the capital <span style=\"color:#cdd6ff\">${q.item.capital}</span>?</div>
        <div class=\"sub\">Type the country and press <span class=\"kbd\">Enter</span>.</div>
        <div class=\"row\" style=\"margin-top: 10px;\">
          <input id=\"answerInput\" type=\"text\" placeholder=\"Country name…\" autocomplete=\"off\" />
          <button class=\"primary\" id=\"btnSubmit\">Submit</button>
          <button id=\"btnHelp\">Help</button>
        </div>
        <div class=\"hints\" id=\"hintBox\">
          <div class=\"sub\">Pick one (but you still must type the answer):</div>
          <div class=\"hintGrid\" id=\"hintGrid\"></div>
        </div>
      `;
      wireTextSubmit(q, "country");
      wireHintButton({ type: "country", item: q.item });
    }
    const input = $("#answerInput");
    if (input) setTimeout(() => input.focus(), 50);
  }
  function nextQuestion() {
    if (!state.items.length) {
      elPrompt.innerHTML = `
        <div class=\"question\">No data loaded yet.</div>
        <div class=\"sub\">
          Put <span class=\"kbd\">flags_manifest.json</span> in the root folder and serve via
          <span class=\"kbd\">python -m http.server</span>, or use Setup / Import to paste JSON.
        </div>
      `;
      elModeName.textContent = "—";
      return;
    }
    let mode = pickMode();
    let item = pickRandomItem();
    if (mode.id === 1 || mode.id === 3) {
      let tries = 0;
      while (tries++ < 10 && item && !bestFlagPath(item)) item = pickRandomItem(item);
    }
    const q = { mode, item, choices: null };
    if (mode.id === 2) q.choices = buildChoices(item, 4);
    state.current = q;
    renderQuestion(q);
  }
  function resetGame() {
    state.score = 0;
    state.streak = 0;
    state.progress = 0;
    state.locked = false;
    clearResult();
    setHud();
    nextQuestion();
  }
  function pickDecoys({ type, correctValue, count }) {
    const seen = new Set();
    const pool = [];
    for (const it of state.items) {
      const v = (type === "country" ? it.country : it.capital) || "";
      const norm = normalizeAnswer(v);
      if (!norm) continue;
      if (norm === normalizeAnswer(correctValue)) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      pool.push(v);
    }
    shuffle(pool);
    return pool.slice(0, count);
  }
  function buildHintOptions({ type, item }) {
    const correctValue = type === "country" ? item.country : item.capital;
    const decoys = pickDecoys({ type, correctValue, count: 3 });
    const options = shuffle([correctValue, ...decoys]);
    return options;
  }
  function wireHintButton({ type, item }) {
    const btn = document.querySelector("#btnHelp");
    const box = document.querySelector("#hintBox");
    const grid = document.querySelector("#hintGrid");
    if (!btn || !box || !grid) return;
    const options = buildHintOptions({ type, item });
    grid.innerHTML = options.map(opt => `<button class=\"hintChip\" type=\"button\">${opt}</button>`).join("");
    btn.addEventListener("click", () => {
      box.classList.toggle("show");
    });
    // Enable clicking a hint to fill and submit
    grid.querySelectorAll(".hintChip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const input = document.querySelector("#answerInput");
        if (input) {
          input.value = chip.textContent;
          const submitBtn = document.querySelector("#btnSubmit");
          if (submitBtn) submitBtn.click();
        }
      });
    });
  }
  if (!SHOW_SETTINGS_PANEL) {
    const sidebar = document.querySelector("aside.card");
    if (sidebar) sidebar.style.display = "none";
    const grid = document.querySelector(".grid");
    if (grid) grid.style.gridTemplateColumns = "1fr";
  }
  async function init() {
    setHud();
    btnNext.addEventListener("click", nextQuestion);
    btnSkip.addEventListener("click", () => {
      if (!state.items.length) return;
      state.streak = 0;
      state.progress += 1;
      setHud();
      showResult(false, `⏭️ Skipped. Answer was: ${state.current?.item?.country ?? "—"} — ${state.current?.item?.capital ?? "—"}`);
      state.locked = true;
    });
    btnReset.addEventListener("click", resetGame);
    btnShuffle.addEventListener("click", () => {
      state.items = shuffle(state.items);
      showResult(true, "🔀 Shuffled question pool.");
    });
    btnToggleSetup.addEventListener("click", toggleSetup);
    btnUsePasted.addEventListener("click", usePastedJson);
    btnClearLocal.addEventListener("click", clearLocal);
    window.addEventListener("keydown", (e) => {
      const isTyping = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
      const k = e.key.toLowerCase();
      if (!isTyping) {
        if (k === "n") nextQuestion();
        if (k === "s") btnSkip.click();
        if (k === "h") {
          const helpBtn = document.querySelector("#btnHelp");
          if (helpBtn) helpBtn.click();
        }
      } else {
        if ((e.ctrlKey || e.metaKey) && k === "h") {
          e.preventDefault();
          const helpBtn = document.querySelector("#btnHelp");
          if (helpBtn) helpBtn.click();
        }
      }
    });
    const manifest = await tryLoadManifest();
    if (manifest) {
      const count = setItemsFromManifestObject(manifest);
      if (count) resetGame();
      else setup.classList.add("show");
    } else {
      setup.classList.add("show");
      nextQuestion();
    }
  }
  init();
})();
