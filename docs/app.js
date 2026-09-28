/* Мини-апп «Планы тренировок»: опрос → план по дням → тренировка с таймером. */
(function () {
  "use strict";

  const BOT_USERNAME = "workoutplan_bot";
  const STORE_KEY = "state_v1";
  const P = window.Planner;

  const tg = window.Telegram && window.Telegram.WebApp;
  const inTelegram = !!(tg && tg.platform && tg.platform !== "unknown");
  // Из обычной кнопки-клавиатуры Telegram открывает мини-апп без initData,
  // и только в этом режиме работает sendData — отправка ответов боту.
  const canSendData = inTelegram && !tg.initData;
  const cloud = inTelegram && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9") ? tg.CloudStorage : null;

  const app = document.getElementById("app");
  let LIB = [];
  let BY_KEY = {};
  let state = { plan: null, done: [], day: 0 };

  /* ---------- утилиты ---------- */

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v; // только для своих SVG-иконок
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const ICON = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 18l-8-6 8-6v12zM6 6v12"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l8 6-8 6V6zM18 6v12"/></svg>',
    chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  function icon(name) { return h("span", { class: "ic", html: ICON[name], "aria-hidden": "true" }); }

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  function amountText(key, sets, amount) {
    const e = BY_KEY[key];
    return `${sets} × ${e.mode === "time" ? amount + " с" : amount}`;
  }

  function clip(key, cls) {
    const url = `url("img/${encodeURIComponent(key)}.webp")`;
    return h("div", { class: cls, "aria-hidden": "true" },
      h("i", { style: `background-image:${url}` }),
      h("i", { style: `background-image:${url}` }));
  }

  function haptic(kind) {
    try {
      if (!inTelegram || !tg.HapticFeedback) return;
      if (kind === "tap") tg.HapticFeedback.selectionChanged();
      else tg.HapticFeedback.notificationOccurred(kind);
    } catch (e) { /* не критично */ }
  }

  function confirmDialog(text, cb) {
    if (inTelegram && tg.showConfirm && tg.isVersionAtLeast("6.2")) tg.showConfirm(text, cb);
    else cb(window.confirm(text));
  }

  /* ---------- хранение ---------- */

  function saveState() {
    const raw = JSON.stringify(state);
    try { localStorage.setItem(STORE_KEY, raw); } catch (e) { /* приватный режим */ }
    if (cloud && raw.length <= 4096) cloud.setItem(STORE_KEY, raw, () => {});
  }

  function loadState() {
    return new Promise((resolve) => {
      const fromLocal = () => {
        try { resolve(JSON.parse(localStorage.getItem(STORE_KEY))); } catch (e) { resolve(null); }
      };
      if (!cloud) return fromLocal();
      cloud.getItem(STORE_KEY, (err, val) => {
        if (err || !val) return fromLocal();
        try { resolve(JSON.parse(val)); } catch (e) { fromLocal(); }
      });
    });
  }

  function setPlan(plan) {
    const same = state.plan && JSON.stringify(state.plan.d) === JSON.stringify(plan.d);
    state = same ? { ...state, plan } : { plan, done: [], day: 0 };
    saveState();
  }

  /* ---------- экран: опрос ---------- */

  function renderSurvey(note) {
    const s = { goal: null, level: null, eq: null, days: 3, avoid: [] };
    const submit = h("button", { class: "btn", disabled: true, onclick: onSubmit }, "Составить план");

    function group(title, key, options, cls) {
      const wrap = h("div", { class: "opts" + (cls ? " " + cls : ""), role: "group", "aria-label": title });
      const buttons = options.map(([val, label, sub]) => {
        const b = h("button", { class: "opt", "aria-pressed": String(s[key] === val) }, label, sub ? h("small", {}, sub) : null);
        b.addEventListener("click", () => {
          s[key] = val;
          buttons.forEach((x, i) => x.setAttribute("aria-pressed", String(options[i][0] === val)));
          haptic("tap");
          refresh();
        });
        return b;
      });
      wrap.append(...buttons);
      return [h("h2", {}, title), wrap];
    }

    function avoidGroup() {
      const opts = [["", "Нет"]].concat(Object.entries(P.AVOID));
      const wrap = h("div", { class: "opts", role: "group", "aria-label": "Ограничения" });
      const buttons = opts.map(([val, label]) => {
        const b = h("button", { class: "opt" }, label);
        b.addEventListener("click", () => {
          if (!val) s.avoid = [];
          else s.avoid = s.avoid.includes(val) ? s.avoid.filter((a) => a !== val) : s.avoid.concat(val);
          paint();
          haptic("tap");
        });
        return b;
      });
      function paint() {
        buttons.forEach((b, i) => {
          const val = opts[i][0];
          b.setAttribute("aria-pressed", String(val ? s.avoid.includes(val) : s.avoid.length === 0));
        });
      }
      paint();
      wrap.append(...buttons);
      return [h("h2", {}, "Что беречь"), wrap];
    }

    function refresh() { submit.disabled = !(s.goal && s.level && s.eq); }

    function onSubmit() {
      const survey = P.validateSurvey(s);
      if (canSendData) {
        submit.disabled = true;
        submit.textContent = "Отправляю…";
        tg.sendData(JSON.stringify(survey)); // Telegram закроет мини-апп, план пришлёт бот
        return;
      }
      setPlan(P.buildPlan(LIB, survey));
      renderPlan();
    }

    const screen = h("section", { class: "screen" },
      h("p", { class: "eyebrow" }, "Новый план"),
      h("h1", {}, "Расскажи о себе"),
      note ? h("p", { class: "done-note" }, note) : null,
      group("Цель", "goal", Object.entries(P.GOALS).map(([k, v]) => [k, v.title])),
      group("Уровень", "level", Object.entries(P.LEVELS).map(([k, v]) => [Number(k), v])),
      group("Где тренируешься", "eq", [["none", "Дома", "без инвентаря"], ["dumbbell", "Дома", "с гантелями"], ["gym", "В зале"]]),
      group("Дней в неделю", "days", [2, 3, 4, 5, 6].map((n) => [n, String(n)]), "row"),
      avoidGroup(),
      !inTelegram ? h("p", { class: "muted", style: "font-size:13px;margin-top:20px" },
        "Это демо в браузере: план собирается по правилам. В Telegram упражнения подбирает ИИ — ",
        h("a", { class: "link", href: `https://t.me/${BOT_USERNAME}` }, "@" + BOT_USERNAME)) : null,
      h("div", { class: "bar" }, h("div", { class: "bar-in" },
        state.plan ? h("button", { class: "btn ghost", onclick: renderPlan }, "Назад") : null,
        submit)));
    show(screen);
  }

  /* ---------- экран: план ---------- */

  function renderPlan() {
    const plan = state.plan;
    const dayIdx = Math.min(state.day || 0, plan.d.length - 1);
    const day = plan.d[dayIdx];
    const minutes = P.estimateMinutes(LIB, day, plan.g);
    const isDone = state.done.includes(dayIdx);

    const tabs = h("div", { class: "tabs", role: "tablist" }, plan.d.map((d, i) =>
      h("button", {
        class: "tab", role: "tab", "aria-selected": String(i === dayIdx),
        onclick: () => { state.day = i; saveState(); haptic("tap"); renderPlan(); },
      }, `День ${i + 1}`, state.done.includes(i) ? h("span", { class: "dot", "aria-label": "выполнен" }) : null)));

    const list = h("ol", { class: "list" }, day.x.map(([k, sets, amount], i) =>
      h("li", {}, h("button", { class: "item", onclick: () => openExercise(k, sets, amount) },
        h("span", { class: "n" }, i + 1),
        clip(k, "thumb"),
        h("span", { class: "t" }, h("b", {}, BY_KEY[k].name), h("span", {}, amountText(k, sets, amount))),
        h("span", { class: "chev", html: ICON.chev })))));

    const screen = h("section", { class: "screen" },
      h("div", { class: "head" }, h("div", {},
        h("p", { class: "eyebrow" }, [P.GOALS[plan.g].title, plan.src === "ai" ? "подобрано ИИ" : null].filter(Boolean).join(" · ")),
        h("h1", {}, "Твой план"))),
      tabs,
      h("h2", { style: "margin-top:0;font-size:20px;letter-spacing:-.01em" }, day.t),
      h("div", { class: "summary" }, h("span", {}, `${day.x.length} упражнений`), h("span", {}, `~${minutes} мин`),
        h("span", {}, `отдых ${P.GOALS[plan.g].rest} с`)),
      list,
      isDone ? h("p", { class: "done-note" }, "Этот день уже выполнен. Можно повторить или перейти к следующему.") : null,
      h("div", { class: "bar" }, h("div", { class: "bar-in" },
        h("button", { class: "btn ghost", onclick: () => renderSurvey() }, "Новый план"),
        h("button", { class: "btn", onclick: () => startWorkout(dayIdx) }, "Начать тренировку"))));
    show(screen);
  }

  function openExercise(k, sets, amount) {
    const e = BY_KEY[k];
    const sheet = document.getElementById("sheet");
    const body = document.getElementById("sheet-body");
    body.replaceChildren(
      clip(k, "clip"),
      h("h3", {}, e.name),
      h("p", { class: "muted num" }, amountText(k, sets, amount)),
      h("p", {}, e.cue),
      h("button", { class: "btn", style: "width:100%", "data-close": "" }, "Понятно"));
    sheet.hidden = false;
    haptic("tap");
  }

  document.getElementById("sheet").addEventListener("click", (ev) => {
    if (ev.target.closest("[data-close]")) document.getElementById("sheet").hidden = true;
  });

  /* ---------- тренировка ---------- */

  let wk = null; // состояние текущей тренировки
  let audio = null;

  function beep(freq, ms) {
    try {
      if (!audio) return;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + ms / 1000);
    } catch (e) { /* звук не обязателен */ }
  }

  function startWorkout(dayIdx) {
    const day = state.plan.d[dayIdx];
    const rest = P.GOALS[state.plan.g].rest;
    const steps = [{ type: "prep", dur: 5 }];
    day.x.forEach(([k, sets, amount], i) => {
      for (let j = 0; j < sets; j++) {
        steps.push({ type: "work", i, j, k, sets, amount, mode: BY_KEY[k].mode });
        const last = i === day.x.length - 1 && j === sets - 1;
        if (!last) steps.push({ type: "rest", dur: rest });
      }
    });
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) { audio = null; }

    const now = performance.now();
    wk = {
      dayIdx, day, steps, idx: 0,
      totalSets: steps.filter((s) => s.type === "work").length,
      doneSteps: new Set(), skippedEx: new Set(),
      startedAt: now, pausedTotal: 0, stepStart: now, stepPaused: 0,
      pausedAt: null, lastWhole: null, timer: null, wake: null,
    };
    if (inTelegram) {
      try { tg.enableClosingConfirmation(); } catch (e) {}
      try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {}
    }
    if (navigator.wakeLock) navigator.wakeLock.request("screen").then((l) => { if (wk) wk.wake = l; }).catch(() => {});
    wk.timer = setInterval(tick, 200);
    renderStep();
  }

  function stopWorkoutTimers() {
    if (!wk) return;
    clearInterval(wk.timer);
    if (wk.wake) wk.wake.release().catch(() => {});
    if (inTelegram) {
      try { tg.disableClosingConfirmation(); } catch (e) {}
      try { if (tg.enableVerticalSwipes) tg.enableVerticalSwipes(); } catch (e) {}
    }
  }

  const isPaused = () => wk.pausedAt !== null;
  const stepElapsed = (now) => ((isPaused() ? wk.pausedAt : now) - wk.stepStart - wk.stepPaused) / 1000;
  const totalElapsed = (now) => ((isPaused() ? wk.pausedAt : now) - wk.startedAt - wk.pausedTotal) / 1000;
  const cur = () => wk.steps[wk.idx];

  function goTo(idx) {
    if (idx >= wk.steps.length) return finishWorkout(true);
    wk.idx = idx;
    const now = performance.now();
    wk.stepStart = isPaused() ? wk.pausedAt : now;
    wk.stepPaused = 0;
    wk.lastWhole = null;
    renderStep();
  }

  function completeSet() {
    wk.doneSteps.add(wk.idx);
    wk.skippedEx.delete(cur().i);
    haptic("success");
    goTo(wk.idx + 1);
  }

  function togglePause() {
    const now = performance.now();
    if (isPaused()) {
      const d = now - wk.pausedAt;
      wk.pausedTotal += d;
      wk.stepPaused += d;
      wk.pausedAt = null;
    } else {
      wk.pausedAt = now;
    }
    haptic("tap");
    renderStep();
  }

  function skipExercise() {
    const c = cur();
    const exIdx = c.type === "work" ? c.i : nextWork(wk.idx).i;
    if (exIdx == null) return;
    wk.skippedEx.add(exIdx);
    let n = wk.idx;
    while (n < wk.steps.length && !(wk.steps[n].type === "work" && wk.steps[n].i > exIdx)) n++;
    haptic("warning");
    goTo(n);
  }

  function prevStep() {
    // Из отдыха — к только что сделанному подходу, из подхода — к предыдущему подходу.
    let n = wk.idx - 1;
    while (n > 0 && wk.steps[n].type !== "work") n--;
    if (n < 1) n = 1;
    if (wk.steps[n].type !== "work") return;
    wk.doneSteps.delete(n);
    wk.skippedEx.delete(wk.steps[n].i);
    haptic("tap");
    goTo(n);
  }

  function nextWork(from) {
    for (let n = from + 1; n < wk.steps.length; n++) if (wk.steps[n].type === "work") return wk.steps[n];
    return { i: null };
  }

  function tick() {
    if (!wk) return;
    const now = performance.now();
    const c = cur();
    const el = (id) => document.getElementById(id);
    const total = el("wk-elapsed");
    if (total) total.textContent = fmt(totalElapsed(now));
    if (isPaused()) return;
    const t = stepElapsed(now);

    if (c.type === "work" && c.mode === "reps") {
      const sw = el("wk-stopwatch");
      if (sw) sw.textContent = fmt(t);
      return;
    }
    const dur = c.type === "work" ? c.amount : c.dur;
    const left = dur - t;
    const whole = Math.ceil(left);
    if (whole !== wk.lastWhole) {
      wk.lastWhole = whole;
      if (whole <= 3 && whole >= 1) beep(660, 90);
    }
    const val = el("wk-count");
    if (val) val.textContent = c.type === "work" ? fmt(left) : String(Math.max(0, whole));
    const bar = el("wk-bar");
    if (bar) bar.style.width = Math.min(100, (t / dur) * 100) + "%";
    const ring = el("wk-ring");
    if (ring) ring.style.strokeDashoffset = String(RING_LEN * Math.min(1, t / dur));
    if (left <= 0) {
      beep(880, 260);
      if (c.type === "work") completeSet();
      else { haptic("success"); goTo(wk.idx + 1); }
    }
  }

  const RING_LEN = 2 * Math.PI * 100;

  function topBar() {
    const doneRatio = wk.idx / wk.steps.length;
    return h("div", { class: "wk-top" },
      h("button", { class: "icon", "aria-label": "Завершить тренировку", html: ICON.close, onclick: askFinish }),
      h("div", { class: "progress", "aria-hidden": "true" }, h("div", { style: `width:${doneRatio * 100}%` })),
      h("span", { class: "elapsed num", id: "wk-elapsed" }, fmt(totalElapsed(performance.now()))));
  }

  function control(name, label, onclick, opts = {}) {
    return h("button", { class: "ctl" + (opts.main ? " main" : ""), onclick, disabled: opts.disabled, "aria-label": label },
      h("span", { class: "icon", html: ICON[name] }), opts.main ? null : label);
  }

  function renderStep() {
    const c = cur();
    const paused = isPaused();
    const firstWork = wk.steps.findIndex((s) => s.type === "work");
    const controls = (skipLabel, onSkip) => h("div", { class: "controls" },
      control("back", "Назад", prevStep, { disabled: wk.idx <= firstWork }),
      control(paused ? "play" : "pause", paused ? "Продолжить" : "Пауза", togglePause, { main: true }),
      control("next", skipLabel, onSkip));

    let body;
    if (c.type === "work") {
      const e = BY_KEY[c.k];
      const timed = c.mode === "time";
      body = h("div", { class: "wk-body" + (paused ? " paused" : "") },
        clip(c.k, "clip"),
        h("div", { class: "wk-name" }, e.name),
        h("div", { class: "wk-sub num" }, `Подход ${c.j + 1} из ${c.sets} · упражнение ${c.i + 1} из ${wk.day.x.length}`),
        h("div", { class: "cue" }, e.cue),
        timed
          ? [h("div", { class: "timer", id: "wk-count" }, fmt(c.amount)), h("div", { class: "bar-line" }, h("div", { id: "wk-bar", style: "width:0" }))]
          : [h("div", { class: "timer" }, c.amount, h("small", {}, "повторений")),
             h("div", { class: "muted num" }, "Время подхода ", h("span", { id: "wk-stopwatch" }, "0:00"))],
        paused ? h("div", { class: "pause-tag", style: "margin-top:12px" }, "Пауза") : null,
        !timed ? h("div", { class: "wk-done" }, h("button", { class: "btn", onclick: completeSet }, "Подход выполнен")) : null,
        controls("Пропустить", skipExercise));
    } else {
      const nw = nextWork(wk.idx);
      const ne = BY_KEY[nw.k];
      body = h("div", { class: "wk-body rest" + (paused ? " paused" : "") },
        h("p", { class: "eyebrow", style: "margin-top:8px" }, c.type === "prep" ? "Приготовься" : paused ? "Отдых · пауза" : "Отдых"),
        h("div", { class: "ring", html:
          `<svg viewBox="0 0 220 220" aria-hidden="true"><circle class="track" cx="110" cy="110" r="100"/>` +
          `<circle id="wk-ring" class="fill" cx="110" cy="110" r="100" stroke-dasharray="${RING_LEN}" stroke-dashoffset="0"/></svg>` +
          `<div class="val" id="wk-count">${Number(c.dur)}</div>` }),
        h("div", { class: "chips" },
          h("button", { class: "chip", onclick: () => { c.dur += 15; wk.lastWhole = null; haptic("tap"); } }, "+15 с"),
          h("button", { class: "chip", onclick: () => goTo(wk.idx + 1) }, c.type === "prep" ? "Начать сразу" : "Пропустить отдых")),
        ne ? h("div", { class: "next" }, clip(nw.k, "thumb"),
          h("div", { class: "t" }, h("span", {}, `Далее · подход ${nw.j + 1} из ${nw.sets}`), h("b", {}, ne.name)),
          h("span", { class: "muted num" }, amountText(nw.k, 1, nw.amount).replace(/^1 × /, ""))) : null,
        controls("Дальше", () => goTo(wk.idx + 1)));
    }
    show(h("section", { class: "wk" }, topBar(), body), true);
    tick();
  }

  function askFinish() {
    const done = wk.doneSteps.size;
    confirmDialog(done ? "Завершить тренировку? Сделанные подходы сохранятся." : "Выйти из тренировки?", (ok) => {
      if (!ok) return;
      if (done) finishWorkout(false);
      else { stopWorkoutTimers(); wk = null; renderPlan(); }
    });
  }

  function finishWorkout(completed) {
    stopWorkoutTimers();
    const seconds = totalElapsed(performance.now());
    const w = wk;
    wk = null;
    const setsDone = w.doneSteps.size;
    const exDone = w.day.x.filter((_, i) => w.steps.every((s, n) => s.type !== "work" || s.i !== i || w.doneSteps.has(n))).length;
    haptic("success");

    const screen = h("section", { class: "screen" },
      h("div", { class: "big-check", html: ICON.check }),
      h("h1", {}, completed ? "Тренировка завершена" : "Тренировка остановлена"),
      h("div", { class: "stats" },
        h("div", { class: "stat" }, h("b", {}, fmt(seconds)), h("span", {}, "время")),
        h("div", { class: "stat" }, h("b", {}, `${setsDone}/${w.totalSets}`), h("span", {}, "подходов")),
        h("div", { class: "stat" }, h("b", {}, exDone), h("span", {}, "упражнений выполнено")),
        h("div", { class: "stat" }, h("b", {}, w.skippedEx.size), h("span", {}, "пропущено"))),
      h("div", { class: "bar" }, h("div", { class: "bar-in" }, h("button", {
        class: "btn",
        onclick: () => {
          if (setsDone && !state.done.includes(w.dayIdx)) state.done.push(w.dayIdx);
          if (completed) state.day = (w.dayIdx + 1) % state.plan.d.length;
          saveState();
          renderPlan();
        },
      }, "Готово"))));
    show(screen);
  }

  /* ---------- запуск ---------- */

  function show(node, keepScroll) {
    document.getElementById("sheet").hidden = true;
    app.replaceChildren(node);
    if (!keepScroll) window.scrollTo(0, 0);
  }

  async function init() {
    if (inTelegram) { tg.ready(); tg.expand(); }
    try {
      LIB = await (await fetch("exercises.json", { cache: "no-cache" })).json();
    } catch (e) {
      app.replaceChildren(h("p", { class: "loading" }, "Не удалось загрузить упражнения. Проверь интернет и открой ещё раз."));
      return;
    }
    BY_KEY = Object.fromEntries(LIB.map((e) => [e.k, e]));
    const saved = await loadState();
    if (saved && saved.plan) {
      try { state = { plan: P.sanitizePlan(LIB, saved.plan), done: saved.done || [], day: saved.day || 0 }; } catch (e) { /* старый формат */ }
    }

    const params = new URLSearchParams(location.search);
    try {
      if (params.get("p")) setPlan(P.sanitizePlan(LIB, P.decodeParam(params.get("p"))));
      else if (params.get("s")) setPlan(P.buildPlan(LIB, P.decodeParam(params.get("s"))));
    } catch (e) {
      return renderSurvey("Ссылка на план повреждена. Пройди опрос заново.");
    }
    if (state.plan && !canSendData) renderPlan();
    else renderSurvey();
  }

  init();
})();
