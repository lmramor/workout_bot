/* Мини-апп «Планы тренировок»: опрос → план по дням → тренировка с таймером. */
(function () {
  "use strict";

  const BOT_USERNAME = "workoutplan_bot";
  const STORE_KEY = "state_v1";
  const PREP_SECONDS = 5; // отсчёт «Приготовься» перед упражнениями на время
  const P = window.Planner;

  const tg = window.Telegram && window.Telegram.WebApp;
  const inTelegram = !!(tg && tg.platform && tg.platform !== "unknown");
  const tgAtLeast = (v) => inTelegram && tg.isVersionAtLeast && tg.isVersionAtLeast(v);
  // Из кнопки-клавиатуры Telegram открывает мини-апп без initData,
  // и только в этом режиме работает sendData — отправка ответов боту.
  const canSendData = inTelegram && !tg.initData;
  const cloud = tgAtLeast("6.9") ? tg.CloudStorage : null;

  const app = document.getElementById("app");
  const sheetEl = document.getElementById("sheet");
  const sheetBody = document.getElementById("sheet-body");
  let LIB = [];
  let BY_KEY = {};
  let state = { plan: null, done: [], day: 0, kcal: 0 };

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
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 18l-8-6 8-6v12zM6 6v12"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l8 6-8 6V6zM18 6v12"/></svg>',
    chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  const fmt = (sec) => {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  };
  const plural = (n, one, few, many) => {
    const a = n % 10, b = n % 100;
    return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
  };
  const amountText = (key, sets, amount) => `${sets} × ${BY_KEY[key].mode === "time" ? amount + " с" : amount}`;
  const todayIdx = () => (new Date().getDay() + 6) % 7; // понедельник = 0

  function clip(key, cls) {
    const url = `url("img/${encodeURIComponent(key)}.webp")`;
    return h("div", { class: cls, "aria-hidden": "true" },
      h("i", { style: `background-image:${url}` }), h("i", { style: `background-image:${url}` }));
  }

  function haptic(kind) {
    try {
      if (!inTelegram || !tg.HapticFeedback) return;
      if (kind === "tap") tg.HapticFeedback.selectionChanged();
      else if (kind === "impact") tg.HapticFeedback.impactOccurred("medium");
      else tg.HapticFeedback.notificationOccurred(kind);
    } catch (e) { /* не критично */ }
  }

  function confirmDialog(text, cb) {
    if (tgAtLeast("6.2")) tg.showConfirm(text, cb);
    else cb(window.confirm(text));
  }

  // Системная кнопка «Назад» в шапке Telegram дублирует нашу стрелку
  let backHandler = null;
  function setBack(fn) {
    if (!tgAtLeast("6.1")) return;
    if (backHandler) tg.BackButton.offClick(backHandler);
    backHandler = fn;
    if (fn) { tg.BackButton.onClick(fn); tg.BackButton.show(); } else tg.BackButton.hide();
  }

  function nav({ back, steps, step, menu }) {
    return h("div", { class: "nav" },
      back ? h("button", { class: "icon", "aria-label": "Назад", html: ICON.arrow, onclick: back }) : null,
      steps ? h("div", { class: "steps", "aria-label": `Шаг ${step + 1} из ${steps}` },
        Array.from({ length: steps }, (_, i) => h("i", { class: i <= step ? "on" : "" }))) : h("div", { class: "grow" }),
      menu ? h("button", { class: "icon", "aria-label": "Меню", html: ICON.dots, onclick: menu }) : null);
  }

  function show(node, opts = {}) {
    closeSheet();
    if (opts.backAnim) node.classList.add("back-anim");
    app.replaceChildren(node);
    if (!opts.keepScroll) window.scrollTo(0, 0);
  }

  function openSheet(...kids) {
    sheetBody.replaceChildren(...kids);
    sheetEl.hidden = false;
    haptic("tap");
  }
  function closeSheet() { sheetEl.hidden = true; }
  sheetEl.addEventListener("click", (ev) => { if (ev.target.closest("[data-close]")) closeSheet(); });

  function optButton({ label, sub, em, pressed, multi, disabled, wide, onclick }) {
    return h("button", { class: "opt", "aria-pressed": String(!!pressed), disabled, onclick, style: wide ? "grid-column:1/-1" : null },
      em ? h("span", { class: "em", "aria-hidden": "true" }, em) : null,
      h("span", { class: "tx" }, label, sub ? h("small", {}, sub) : null),
      multi ? h("span", { class: "mark", html: ICON.check }) : null);
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

  function hash(str) {
    let x = 5381;
    for (let i = 0; i < str.length; i++) x = ((x << 5) + x + str.charCodeAt(i)) | 0;
    return "h" + (x >>> 0).toString(36);
  }

  /** Новый план из ответов опроса. Если ссылка та же — сохраняем прогресс и текущую неделю. */
  function setPlanFromSurvey(survey, id) {
    if (state.plan && state.plan.id === id) return;
    const s = P.validateSurvey(survey);
    if (s.wd) s.wd = P.orderWeekdays(s.wd, todayIdx()); // «День 1» — ближайший тренировочный день
    state = { plan: { ...P.buildPlan(LIB, s, 1), id }, done: [], day: 0, kcal: 0 };
    saveState();
  }

  /** Если сегодня день тренировки и он ещё не сделан — открываем его. */
  function pickToday() {
    const wd = state.plan.s && state.plan.s.wd;
    const i = wd ? wd.indexOf(todayIdx()) : -1;
    if (i >= 0 && i < state.plan.d.length && !state.done.includes(i)) state.day = i;
  }

  function surveyOf(plan) {
    return plan.s || { goal: plan.g, level: 2, eq: "gym", days: 3, avoid: [], focus: [] };
  }

  /* ---------- экран: опрос по одному вопросу ---------- */

  function renderSurvey(step = 0, draft, backAnim) {
    const prev = state.plan && state.plan.s;
    const s = draft || {
      goal: prev ? prev.goal : null,
      level: prev ? prev.level : null,
      eq: prev ? prev.eq : null,
      focus: prev ? prev.focus.slice() : [],
      wd: prev && prev.wd ? prev.wd.slice() : [],
      avoid: prev ? prev.avoid.slice() : [],
      kg: prev && prev.kg ? prev.kg : 70,
      remind: null,
    };

    const steps = [
      {
        title: "Какая у тебя цель?", lead: "От неё зависят повторения и отдых между подходами.", key: "goal",
        options: Object.entries(P.GOALS).map(([v, g]) => ({ v, label: g.title, em: g.icon })),
      },
      {
        title: "Какой у тебя уровень?", lead: "Новичкам не дам сложных упражнений.", key: "level",
        options: [
          { v: 1, label: "Новичок", sub: "только начинаю или был долгий перерыв", em: "🌱" },
          { v: 2, label: "Средний", sub: "тренируюсь регулярно", em: "🌿" },
          { v: 3, label: "Продвинутый", sub: "занимаюсь больше двух лет", em: "🌳" },
        ],
      },
      {
        title: "Где будешь заниматься?", lead: "Подберу упражнения под инвентарь.", key: "eq",
        options: [
          { v: "none", label: "Дома без инвентаря", sub: "только вес тела", em: "🏠" },
          { v: "dumbbell", label: "Дома с гантелями", sub: "пара гантелей и стул", em: "🏋️" },
          { v: "gym", label: "В зале", sub: "тренажёры и штанга", em: "🏢" },
        ],
      },
      { title: "Что хочешь прокачать?", lead: "Можно выбрать несколько: добавлю на них упражнения в каждый день.", kind: "focus" },
      { title: "В какие дни тренируешься?", lead: "Выбери от 2 до 6 дней.", kind: "days" },
      { title: "Что нужно беречь?", lead: "Уберу упражнения, которые нагружают эти места.", kind: "avoid" },
      { title: "Сколько ты весишь?", lead: "Нужно, чтобы считать сожжённые калории. Можно примерно.", kind: "kg" },
    ];
    if (canSendData) {
      steps.push({
        title: "Напоминать о тренировках?", lead: "Бот спросит, во сколько, и будет писать в дни тренировок.", key: "remind",
        options: [
          { v: true, label: "Да, напоминай", sub: "время напишешь боту сам", em: "🔔" },
          { v: false, label: "Не нужно", em: "🔕" },
        ],
      });
    }

    const cur = steps[step];
    const last = step === steps.length - 1;
    const go = (n, back) => renderSurvey(n, s, back);
    const goBack = () => (step > 0 ? go(step - 1, true) : state.plan ? renderPlan(true) : null);
    setBack(step > 0 || state.plan ? goBack : null);

    const nextBtn = h("button", { class: "btn", onclick: () => (last ? submit() : go(step + 1)) }, last ? "Составить план" : "Далее");
    let body;

    if (cur.key) {
      // Один вариант: выбираешь, потом «Далее»
      nextBtn.disabled = s[cur.key] == null;
      body = h("div", { class: "opts" + (cur.two ? " two" : "") }, cur.options.map((o) => optButton({
        ...o,
        pressed: s[cur.key] === o.v,
        onclick: () => { s[cur.key] = o.v; haptic("tap"); go(step); },
      })));
    } else if (cur.kind === "focus") {
      const avail = new Set(P.availableMuscles(LIB, { ...s, days: 3, avoid: [], focus: [] }));
      s.focus = s.focus.filter((m) => avail.has(m));
      const toggle = (m) => {
        s.focus = m === null ? [] : s.focus.includes(m) ? s.focus.filter((x) => x !== m) : s.focus.concat(m);
        haptic("tap");
        go(step);
      };
      body = h("div", {},
        h("div", { class: "opts", style: "margin-bottom:8px" },
          optButton({ label: "Всё тело равномерно", em: "✨", pressed: !s.focus.length, multi: true, onclick: () => toggle(null) })),
        h("div", { class: "opts two" }, Object.entries(P.MUSCLES).map(([m, label]) => optButton({
          label, multi: true, pressed: s.focus.includes(m), disabled: !avail.has(m),
          sub: avail.has(m) ? null : "нужен инвентарь", onclick: () => toggle(m),
        }))));
    } else if (cur.kind === "days") {
      const n = s.wd.length;
      nextBtn.disabled = n < 2 || n > 6;
      body = h("div", {},
        h("div", { class: "opts week" }, P.WEEKDAYS.map((d, i) => h("button", {
          class: "opt", "aria-pressed": String(s.wd.includes(i)),
          onclick: () => { s.wd = s.wd.includes(i) ? s.wd.filter((x) => x !== i) : s.wd.concat(i).sort(); haptic("tap"); go(step); },
        }, d))),
        h("p", { class: "counter" }, n
          ? h("span", {}, h("b", {}, `${n} ${plural(n, "тренировка", "тренировки", "тренировок")}`), " в неделю",
            n > 6 ? " — нужен хотя бы один день отдыха" : n < 2 ? " — выбери ещё хотя бы один день" : "")
          : "Нажми на дни, когда удобно заниматься"));
    } else if (cur.kind === "kg") {
      const input = h("input", {
        class: "kg-input num", type: "number", inputmode: "numeric", min: 35, max: 200, value: s.kg, "aria-label": "Вес в килограммах",
        oninput: (ev) => { const v = Number(ev.target.value); nextBtn.disabled = !(v >= 35 && v <= 200); if (!nextBtn.disabled) s.kg = Math.round(v); },
      });
      const stepKg = (d) => { s.kg = Math.min(200, Math.max(35, s.kg + d)); input.value = s.kg; nextBtn.disabled = false; haptic("tap"); };
      body = h("div", { class: "kg" },
        h("button", { class: "icon big", "aria-label": "Меньше", onclick: () => stepKg(-1) }, "−"),
        h("label", { class: "kg-val" }, input, h("span", {}, "кг")),
        h("button", { class: "icon big", "aria-label": "Больше", onclick: () => stepKg(1) }, "+"));
    } else {
      const toggle = (a) => {
        s.avoid = a === null ? [] : s.avoid.includes(a) ? s.avoid.filter((x) => x !== a) : s.avoid.concat(a);
        haptic("tap");
        go(step);
      };
      body = h("div", { class: "opts" },
        optButton({ label: "Ничего, всё в порядке", em: "👍", multi: true, pressed: !s.avoid.length, onclick: () => toggle(null) }),
        Object.entries(P.AVOID).map(([a, label]) => optButton({ label, multi: true, pressed: s.avoid.includes(a), onclick: () => toggle(a) })));
    }

    function submit() {
      const survey = P.validateSurvey(s);
      if (canSendData) {
        nextBtn.disabled = true;
        nextBtn.textContent = "Отправляю…";
        tg.sendData(JSON.stringify({ ...survey, remind: !!s.remind })); // Telegram закроет мини-апп, ссылку на план пришлёт бот
        return;
      }
      setPlanFromSurvey(survey, "local-" + Date.now());
      haptic("success");
      renderPlan();
    }

    const intro = step === 0 && !inTelegram
      ? h("p", { class: "note" }, "Демо в браузере. В Telegram план сохраняется, а бот напоминает о тренировках — ",
        h("a", { class: "link", href: `https://t.me/${BOT_USERNAME}` }, "@" + BOT_USERNAME))
      : null;

    show(h("section", { class: "screen" },
      nav({ back: step > 0 || state.plan ? goBack : null, steps: steps.length, step }),
      h("h1", {}, cur.title),
      h("p", { class: "lead" }, cur.lead),
      body,
      intro,
      h("div", { class: "bar" }, h("div", { class: "bar-in" }, nextBtn))), { backAnim });
  }

  /* ---------- экран: план ---------- */

  function renderPlan(backAnim, dir) {
    setBack(null);
    const plan = state.plan;
    const dayIdx = Math.min(state.day || 0, plan.d.length - 1);
    const day = plan.d[dayIdx];
    const isDone = state.done.includes(dayIdx);
    const wd = plan.s && plan.s.wd;
    const focus = plan.s ? plan.s.focus : [];

    const kg = plan.s ? plan.s.kg : 70;
    const est = P.estimate(LIB, day, plan.g, kg);
    const isToday = (i) => wd && wd[i] === todayIdx();
    const selectDay = (i) => {
      if (i < 0 || i >= plan.d.length || i === dayIdx) return;
      const d = i > dayIdx ? "next" : "prev";
      state.day = i; saveState(); haptic("tap"); renderPlan(false, d);
    };
    const tabs = h("div", { class: "tabs", role: "tablist" }, plan.d.map((d, i) =>
      h("button", { class: "tab", role: "tab", "aria-selected": String(i === dayIdx), onclick: () => selectDay(i) },
        h("b", {}, wd ? P.WEEKDAYS[wd[i]] : i + 1), isToday(i) ? "сегодня" : `день ${i + 1}`,
        state.done.includes(i) ? h("span", { class: "dot", html: ICON.check, "aria-label": "выполнен" }) : null)));

    const list = h("ol", { class: "list" }, day.x.map(([k, sets, amount]) =>
      h("li", {}, h("button", { class: "item", onclick: () => openExercise(k, sets, amount) },
        clip(k, "thumb"),
        h("span", { class: "t" }, h("b", {}, BY_KEY[k].name), h("span", {}, amountText(k, sets, amount))),
        h("span", { class: "chev", html: ICON.chev })))));

    const dayBox = h("div", { class: "day" + (dir ? " slide-" + dir : "") },
      h("p", { class: "day-title" }, day.t),
      h("div", { class: "summary" },
        isToday(dayIdx) && !isDone ? h("span", { class: "pill hot" }, "сегодня") : null,
        isDone ? h("span", { class: "pill hot" }, "✓ выполнен") : null,
        h("span", { class: "pill" }, `${day.x.length} ${plural(day.x.length, "упражнение", "упражнения", "упражнений")}`),
        h("span", { class: "pill" }, `~${est.minutes} мин`),
        h("span", { class: "pill" }, `~${est.kcal} ккал`),
        focus.length ? h("span", { class: "pill" }, "акцент: " + focus.map((m) => P.MUSCLES[m].toLowerCase()).join(", ")) : null),
      list);

    // Свайп влево/вправо переключает дни
    let sx = null, sy = 0;
    dayBox.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    dayBox.addEventListener("touchend", (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      sx = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) selectDay(dayIdx + (dx < 0 ? 1 : -1));
    });

    show(h("section", { class: "screen" },
      h("div", { class: "head" },
        h("div", {},
          h("p", { class: "eyebrow" }, h("b", {}, `Неделя ${plan.w || 1}`), ` · ${P.GOALS[plan.g].title}`,
            state.kcal ? ` · 🔥 ${Math.round(state.kcal)} ккал за неделю` : ""),
          h("h1", {}, "Твой план")),
        h("button", { class: "icon", "aria-label": "Меню", html: ICON.dots, onclick: openMenu })),
      tabs,
      dayBox,
      h("div", { class: "bar" }, h("div", { class: "bar-in" },
        h("button", { class: "btn", onclick: () => startWorkout(day, { kind: "plan", dayIdx }) }, isDone ? "Повторить тренировку" : "Начать тренировку")))),
    { backAnim });
  }

  function openExercise(k, sets, amount, extra) {
    const e = BY_KEY[k];
    openSheet(
      clip(k, "clip"),
      h("h3", {}, e.name),
      h("p", { class: "muted num" }, amountText(k, sets, amount), " · ", e.mus.map((m) => P.MUSCLES[m].toLowerCase()).join(", ")),
      h("p", {}, e.cue),
      extra || h("button", { class: "btn", style: "width:100%", "data-close": "" }, "Понятно"));
  }

  function openMenu() {
    const item = (em, label, sub, onclick, disabled) => optButton({ em, label, sub, onclick, disabled });
    openSheet(
      h("div", { class: "menu" },
        item("⚡", "Быстрая тренировка", "Одна группа мышц, 10–15 минут", () => renderQuick()),
        item("🔔", "Напоминания", inTelegram ? "Настроить дни и время в чате с ботом" : "Доступно в Telegram", () => {
          if (tgAtLeast("6.1")) { tg.openTelegramLink(`https://t.me/${BOT_USERNAME}?start=remind`); tg.close(); }
        }, !inTelegram),
        item("📝", "Новый план", "Пройти опрос заново", () => renderSurvey()),
        item("↺", "Начать неделю заново", "Сбросить отметки о выполненных днях", () => {
          closeSheet();
          confirmDialog("Сбросить отметки этой недели?", (ok) => {
            if (!ok) return;
            state.done = []; state.day = 0; saveState(); renderPlan();
          });
        })),
      h("button", { class: "btn ghost", style: "width:100%;margin-top:12px", "data-close": "" }, "Закрыть"));
  }

  /* ---------- быстрая тренировка ---------- */

  function renderQuick(fromFinish) {
    const s = surveyOf(state.plan);
    const avail = new Set(P.availableMuscles(LIB, s));
    const back = () => renderPlan(true);
    setBack(back);
    show(h("section", { class: "screen" },
      nav({ back }),
      h("h1", {}, fromFinish ? "Ещё одна тренировка?" : "Быстрая тренировка"),
      h("p", { class: "lead" }, "Выбери, что потренировать: 3–5 упражнений по 3 подхода."),
      h("div", { class: "opts two" }, Object.entries(P.MUSCLES).map(([m, label]) => {
        const n = avail.has(m) ? P.buildQuick(LIB, s, m).x.length : 0;
        return optButton({
          label, disabled: !avail.has(m),
          sub: avail.has(m) ? `${n} ${plural(n, "упражнение", "упражнения", "упражнений")}` : "нужен инвентарь",
          onclick: () => previewQuick(P.buildQuick(LIB, s, m)),
        });
      }))));
  }

  function previewQuick(day) {
    openSheet(
      h("h3", {}, day.t),
      h("p", { class: "muted" }, (() => {
        const est = P.estimate(LIB, day, state.plan.g, state.plan.s ? state.plan.s.kg : 70);
        return `${day.x.length} ${plural(day.x.length, "упражнение", "упражнения", "упражнений")} · ~${est.minutes} мин · ~${est.kcal} ккал`;
      })()),
      h("ol", { class: "list", style: "margin-bottom:16px" }, day.x.map(([k, sets, amount]) =>
        h("li", { class: "item" }, clip(k, "thumb"),
          h("span", { class: "t" }, h("b", {}, BY_KEY[k].name), h("span", {}, amountText(k, sets, amount)))))),
      h("button", { class: "btn", style: "width:100%", onclick: () => startWorkout(day, { kind: "quick" }) }, "Начать"));
  }

  /* ---------- тренировка ---------- */

  let wk = null;
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

  function startWorkout(day, ctx) {
    closeSheet();
    setBack(null);
    const rest = P.GOALS[state.plan.g].rest;
    const steps = [];
    // Перед упражнением на повторы — общий отсчёт; у упражнений на время отсчёт встроен в сам подход
    if (BY_KEY[day.x[0][0]].mode === "reps") steps.push({ type: "prep", dur: PREP_SECONDS });
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
      day, ctx, steps, idx: 0,
      totalSets: steps.filter((s) => s.type === "work").length,
      doneSteps: new Set(), skippedEx: new Set(),
      startedAt: now, pausedTotal: 0, stepStart: now, stepPaused: 0,
      pausedAt: null, lastBeep: null, timer: null, wake: null,
      kcal: 0, lastTick: now, kg: state.plan.s ? state.plan.s.kg : 70,
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
    wk.stepStart = isPaused() ? wk.pausedAt : performance.now();
    wk.stepPaused = 0;
    wk.lastBeep = null;
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

  function nextWork(from) {
    for (let n = from + 1; n < wk.steps.length; n++) if (wk.steps[n].type === "work") return wk.steps[n];
    return null;
  }

  function skipExercise() {
    const exIdx = cur().i;
    wk.skippedEx.add(exIdx);
    let n = wk.idx;
    while (n < wk.steps.length && !(wk.steps[n].type === "work" && wk.steps[n].i > exIdx)) n++;
    haptic("warning");
    goTo(n);
  }

  function prevStep() {
    // Из отдыха — к только что сделанному подходу, из подхода — к предыдущему подходу
    let n = wk.idx - 1;
    while (n > 0 && wk.steps[n].type !== "work") n--;
    if (!wk.steps[n] || wk.steps[n].type !== "work") return;
    wk.doneSteps.delete(n);
    wk.skippedEx.delete(wk.steps[n].i);
    haptic("tap");
    goTo(n);
  }

  function beepOnce(key, freq, ms) {
    if (wk.lastBeep === key) return;
    wk.lastBeep = key;
    beep(freq, ms);
  }

  const RING_LEN = 2 * Math.PI * 100;

  /** Интенсивность прямо сейчас: работа — по типу упражнения, отдых и подготовка — лёгкая. */
  function currentMet(c, t) {
    if (c.type !== "work" || (c.mode === "time" && t < PREP_SECONDS)) return P.MET.rest;
    return P.MET[BY_KEY[c.k].cat];
  }

  function tick() {
    if (!wk) return;
    const now = performance.now();
    const c = cur();
    const el = (id) => document.getElementById(id);
    const dt = (now - wk.lastTick) / 1000;
    wk.lastTick = now;
    const total = el("wk-elapsed");
    if (total) total.textContent = fmt(totalElapsed(now));
    if (isPaused()) return;
    const t = stepElapsed(now);
    wk.kcal += P.kcal(currentMet(c, t), wk.kg, Math.min(dt, 2));
    const kc = el("wk-kcal");
    if (kc) kc.textContent = Math.round(wk.kcal);

    if (c.type === "work" && c.mode === "reps") {
      const sw = el("wk-stopwatch");
      if (sw) sw.textContent = fmt(t);
      return;
    }

    if (c.type === "work") {
      const ready = t < PREP_SECONDS;
      const left = ready ? PREP_SECONDS - t : c.amount - (t - PREP_SECONDS);
      const whole = Math.ceil(left);
      const phase = el("wk-phase"), count = el("wk-count"), wrap = el("wk-barwrap"), bar = el("wk-bar");
      if (phase) { phase.textContent = ready ? "Приготовься: займи исходное положение" : "Работаем"; phase.classList.toggle("ready", ready); }
      if (count) { count.textContent = ready ? String(whole) : fmt(left); count.classList.toggle("ready", ready); }
      if (wrap) wrap.classList.toggle("ready", ready);
      if (bar) bar.style.width = Math.min(100, ready ? (t / PREP_SECONDS) * 100 : ((t - PREP_SECONDS) / c.amount) * 100) + "%";
      if (whole >= 1 && whole <= 3) beepOnce((ready ? "r" : "w") + whole, 660, 90);
      if (!ready && t - PREP_SECONDS < 0.3) { beepOnce("go", 990, 220); haptic("impact"); }
      if (!ready && left <= 0) { beep(880, 260); completeSet(); }
      return;
    }

    const left = c.dur - t;
    const whole = Math.ceil(left);
    if (whole >= 1 && whole <= 3) beepOnce("r" + whole, 660, 90);
    const val = el("wk-count");
    if (val) val.textContent = String(Math.max(0, whole));
    const ring = el("wk-ring");
    if (ring) ring.style.strokeDashoffset = String(RING_LEN * Math.min(1, t / c.dur));
    if (left <= 0) { beep(880, 260); haptic("success"); goTo(wk.idx + 1); }
  }

  function control(name, label, onclick, opts = {}) {
    return h("button", { class: "ctl" + (opts.main ? " main" : ""), onclick, disabled: opts.disabled, "aria-label": label },
      h("span", { class: "icon", html: ICON[name] }), opts.main ? null : label);
  }

  function renderStep() {
    const c = cur();
    const paused = isPaused();
    const firstWork = wk.steps.findIndex((s) => s.type === "work");
    const topBar = h("div", { class: "wk-top" },
      h("button", { class: "icon", "aria-label": "Завершить тренировку", html: ICON.close, onclick: askFinish }),
      h("div", { class: "progress", "aria-hidden": "true" }, h("div", { style: `width:${(wk.idx / wk.steps.length) * 100}%` })),
      h("span", { class: "kcal num", title: "Сожжено калорий" }, "🔥 ", h("span", { id: "wk-kcal" }, Math.round(wk.kcal))),
      h("span", { class: "elapsed num", id: "wk-elapsed" }, fmt(totalElapsed(performance.now()))));
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
          ? [h("div", {}, h("span", { class: "phase ready", id: "wk-phase" }, "Приготовься: займи исходное положение")),
             h("div", { class: "timer ready", id: "wk-count" }, String(PREP_SECONDS)),
             h("div", { class: "bar-line ready", id: "wk-barwrap" }, h("div", { id: "wk-bar", style: "width:0" }))]
          : [h("div", {}, h("span", { class: "phase" }, "Повторения")),
             h("div", { class: "timer" }, c.amount, h("small", {}, plural(c.amount, "раз", "раза", "раз"))),
             h("div", { class: "muted num" }, "Время подхода ", h("span", { id: "wk-stopwatch" }, "0:00"))],
        paused ? h("div", { class: "pause-tag" }, "Пауза") : null,
        !timed ? h("div", { class: "wk-done" }, h("button", { class: "btn", onclick: completeSet }, "Подход выполнен")) : null,
        controls("Пропустить", skipExercise));
    } else {
      const nw = nextWork(wk.idx);
      const ne = nw && BY_KEY[nw.k];
      body = h("div", { class: "wk-body rest" + (paused ? " paused" : "") },
        h("div", { class: "rest-head" },
          h("div", { class: "ring", html:
            `<svg viewBox="0 0 220 220" aria-hidden="true"><circle class="track" cx="110" cy="110" r="100"/>` +
            `<circle id="wk-ring" class="fill" cx="110" cy="110" r="100" stroke-dasharray="${RING_LEN}" stroke-dashoffset="0"/></svg>` +
            `<div class="val" id="wk-count">${Number(c.dur)}</div>` }),
          h("div", { class: "rest-info" },
            h("p", { class: "phase" }, c.type === "prep" ? "Приготовься" : paused ? "Отдых · пауза" : "Отдых"),
            h("div", { class: "chips" },
              h("button", { class: "chip", onclick: () => { c.dur += 15; wk.lastBeep = null; haptic("tap"); } }, "+15 с"),
              h("button", { class: "chip", onclick: () => goTo(wk.idx + 1) }, c.type === "prep" ? "Начать сразу" : "Пропустить")))),
        ne ? h("div", { class: "up-next" },
          h("p", { class: "up-label" }, c.type === "prep" ? "Первое упражнение" : nw.j === 0 ? "Следующее упражнение" : "Следующий подход"),
          clip(nw.k, "clip"),
          h("div", { class: "wk-name" }, ne.name),
          h("div", { class: "wk-sub num" }, `Подход ${nw.j + 1} из ${nw.sets} · ${ne.mode === "time" ? nw.amount + " секунд" : nw.amount + " " + plural(nw.amount, "раз", "раза", "раз")}`),
          h("div", { class: "cue" }, ne.cue)) : null,
        controls("Дальше", () => goTo(wk.idx + 1)));
    }
    show(h("section", { class: "wk" }, topBar, body), { keepScroll: true });
    tick();
  }

  function askFinish() {
    const done = wk.doneSteps.size;
    confirmDialog(done ? "Завершить тренировку? Сделанные подходы сохранятся." : "Выйти из тренировки?", (ok) => {
      if (!ok) return;
      if (done) return finishWorkout(false);
      stopWorkoutTimers();
      wk = null;
      renderPlan();
    });
  }

  const WEEKDAY_TO = ["в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу", "в воскресенье"];

  function seeYouText() {
    const wd = state.plan.s && state.plan.s.wd;
    if (!wd || !wd.length) return "Увидимся завтра!";
    const today = todayIdx();
    for (let d = 1; d <= 7; d++) {
      const day = (today + d) % 7;
      if (wd.includes(day)) return d === 1 ? "Увидимся завтра!" : d === 2 ? "Увидимся послезавтра!" : `Увидимся ${WEEKDAY_TO[day]}!`;
    }
    return "Увидимся завтра!";
  }

  function finishWorkout(completed) {
    stopWorkoutTimers();
    const seconds = totalElapsed(performance.now());
    const w = wk;
    wk = null;
    const setsDone = w.doneSteps.size;
    const exDone = w.day.x.filter((_, i) => w.steps.every((s, n) => s.type !== "work" || s.i !== i || w.doneSteps.has(n))).length;
    haptic("success");

    // Отмечаем день сразу — даже если мини-апп закроют на экране итогов
    let weekNote = null;
    state.kcal = (state.kcal || 0) + w.kcal;
    // День засчитывается, если дошёл до конца (даже с пропусками) или сделал хоть один подход
    if (w.ctx.kind === "plan" && (completed || setsDone)) {
      if (!state.done.includes(w.ctx.dayIdx)) state.done.push(w.ctx.dayIdx);
      const allDone = state.plan.d.every((_, i) => state.done.includes(i));
      if (allDone) {
        const old = state.plan;
        const week = (old.w || 1) + 1;
        const next = old.s ? P.buildPlan(LIB, old.s, week) : { ...old, w: week };
        state = { plan: { ...next, id: old.id }, done: [], day: 0, kcal: 0 };
        weekNote = `🏆 Неделя ${week - 1} пройдена! Составил план на неделю ${week}: чуть больше нагрузки и новые упражнения.`;
      } else if (completed) {
        const nextDay = state.plan.d.findIndex((_, i) => !state.done.includes(i));
        state.day = nextDay >= 0 ? nextDay : 0;
      }
    }
    saveState();

    const title = completed ? "Поздравляем!" : "Хорошая работа!";
    const text = w.ctx.kind === "quick"
      ? "Ещё одна тренировка в копилку."
      : completed ? `Тренировка «${w.day.t}» завершена. ${seeYouText()}` : `Сделано ${setsDone} из ${w.totalSets} подходов — это тоже результат.`;

    setBack(null);
    show(h("section", { class: "screen" },
      h("div", { class: "hero" },
        h("div", { class: "big", "aria-hidden": "true" }, completed ? "🎉" : "👏"),
        h("h1", {}, title),
        h("p", {}, text)),
      h("div", { class: "stats" },
        h("div", { class: "stat hot" }, h("b", {}, `🔥 ${Math.round(w.kcal)}`), h("span", {}, "ккал сожжено")),
        h("div", { class: "stat" }, h("b", {}, fmt(seconds)), h("span", {}, "время")),
        h("div", { class: "stat" }, h("b", {}, `${setsDone}/${w.totalSets}`), h("span", {}, "подходов")),
        h("div", { class: "stat" }, h("b", {}, `${exDone}/${w.day.x.length}`), h("span", {}, "упражнений")),
        w.skippedEx.size ? h("div", { class: "stat wide" }, h("span", {}, `Пропущено упражнений: ${w.skippedEx.size} — день всё равно засчитан`)) : null),
      weekNote ? h("p", { class: "note warm" }, weekNote) : null,
      h("div", { class: "bar" }, h("div", { class: "bar-in" },
        h("button", { class: "btn ghost", onclick: () => renderQuick(true) }, "Ещё тренировка"),
        h("button", { class: "btn", onclick: () => renderPlan() }, "Готово")))));
  }

  /* ---------- запуск ---------- */

  // Пока мини-апп не развёрнут, низ окна Telegram может быть за краем экрана —
  // поднимаем нижнюю панель на эту величину, чтобы кнопка всегда была видна.
  function fitViewport() {
    if (!inTelegram || !tg.viewportStableHeight) return;
    const off = Math.max(0, window.innerHeight - tg.viewportStableHeight);
    document.documentElement.style.setProperty("--bar-off", off + "px");
  }

  async function init() {
    if (inTelegram) {
      tg.ready(); tg.expand();
      try { tg.onEvent("viewportChanged", fitViewport); } catch (e) {}
      fitViewport();
    }
    try {
      LIB = await (await fetch("exercises.json", { cache: "no-cache" })).json();
    } catch (e) {
      app.replaceChildren(h("p", { class: "loading" }, "Не удалось загрузить упражнения. Проверь интернет и открой ещё раз."));
      return;
    }
    BY_KEY = Object.fromEntries(LIB.map((e) => [e.k, e]));
    const saved = await loadState();
    if (saved && saved.plan) {
      try {
        state = { plan: { ...P.sanitizePlan(LIB, saved.plan), id: saved.plan.id }, done: saved.done || [], day: saved.day || 0, kcal: saved.kcal || 0 };
      } catch (e) { /* старый формат — начнём заново */ }
    }

    const params = new URLSearchParams(location.search);
    try {
      if (params.get("s")) setPlanFromSurvey(P.decodeParam(params.get("s")), hash(params.get("s")));
    } catch (e) {
      return renderSurvey();
    }
    if (state.plan && !canSendData) { pickToday(); renderPlan(); }
    else renderSurvey();
  }

  init();
})();
